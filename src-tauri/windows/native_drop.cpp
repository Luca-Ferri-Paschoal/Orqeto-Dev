#define NOMINMAX
#include <windows.h>
#include <ole2.h>
#include <shlobj.h>
#include <shellapi.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstddef>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "user32.lib")

namespace {
constexpr std::uint64_t kMaxVirtualDropBytes = 1024ULL * 1024ULL * 1024ULL;
constexpr std::size_t kMaxVirtualDropEntries = 100000;
constexpr std::size_t kMaxPhysicalDropEntries = 50000;
constexpr std::size_t kMaxPhysicalDropCharacters = 16 * 1024 * 1024;
constexpr std::size_t kMaxDropPathCharacters = 32767;
constexpr std::uint32_t kEventEnter = 0;
constexpr std::uint32_t kEventOver = 1;
constexpr std::uint32_t kEventLeave = 2;
constexpr std::uint32_t kEventDrop = 3;

using DropCallback = void(__cdecl *)(
	std::uint32_t,
	std::int32_t,
	std::int32_t,
	const wchar_t* const*,
	std::size_t,
	const wchar_t*
);

DropCallback g_callback = nullptr;
HWND g_parent = nullptr;

struct Registration {
	HWND hwnd;
	IDropTarget* target;
};

std::vector<Registration> g_registrations;

std::wstring Lower(std::wstring value) {
	std::transform(
		value.begin(),
		value.end(),
		value.begin(),
		[](wchar_t character) {
			return static_cast<wchar_t>(std::towlower(character));
		}
	);
	return value;
}

std::wstring NormalizeSeparators(std::wstring value) {
	std::replace(value.begin(), value.end(), L'/', L'\\');
	return value;
}

bool SafeRelativePath(
	const std::wstring& raw,
	std::filesystem::path* output
) {
	if (raw.empty())
		return false;

	const std::filesystem::path path(NormalizeSeparators(raw));
	if (
		path.is_absolute() ||
		path.has_root_name() ||
		path.has_root_directory()
	)
		return false;

	std::filesystem::path normalized;
	for (const auto& component : path) {
		const std::wstring value = component.native();
		if (value.empty() || value == L".")
			continue;
		if (value == L"..")
			return false;
		normalized /= component;
	}

	if (normalized.empty())
		return false;

	*output = normalized;
	return true;
}

std::wstring FindZipInternalPath(const std::wstring& parsing_name) {
	const std::wstring normalized = NormalizeSeparators(parsing_name);
	const std::wstring lower = Lower(normalized);
	const std::wstring marker = L".zip\\";
	const std::size_t marker_position = lower.rfind(marker);

	if (marker_position == std::wstring::npos)
		return L"";

	return normalized.substr(marker_position + marker.size());
}

struct SelectedInternalItem {
	std::filesystem::path path;
	bool is_directory;
};

std::vector<SelectedInternalItem> SelectedInternalItems(IDataObject* data_object) {
	std::vector<SelectedInternalItem> result;
	IShellItemArray* items = nullptr;

	if (FAILED(SHCreateShellItemArrayFromDataObject(
		data_object,
		IID_PPV_ARGS(&items)
	)))
		return result;

	DWORD count = 0;
	if (SUCCEEDED(items->GetCount(&count))) {
		for (DWORD index = 0; index < count; ++index) {
			IShellItem* item = nullptr;
			if (FAILED(items->GetItemAt(index, &item)))
				continue;

			PWSTR parsing_name = nullptr;
			if (SUCCEEDED(item->GetDisplayName(
				SIGDN_DESKTOPABSOLUTEPARSING,
				&parsing_name
			))) {
				std::filesystem::path internal_path;
				if (SafeRelativePath(
					FindZipInternalPath(parsing_name),
					&internal_path
				)) {
					SFGAOF attributes = 0;
					const bool is_directory = SUCCEEDED(item->GetAttributes(
						SFGAO_FOLDER,
						&attributes
					)) && (attributes & SFGAO_FOLDER) != 0;

					result.push_back({
						internal_path,
						is_directory,
					});
				}

				CoTaskMemFree(parsing_name);
			}

			item->Release();
		}
	}

	items->Release();
	return result;
}

bool IsSafeDirectory(const std::filesystem::path& path) {
	const DWORD attributes = GetFileAttributesW(path.c_str());
	return attributes != INVALID_FILE_ATTRIBUTES &&
		(attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 &&
		(attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

bool EnsureDirectoryNoReparse(
	const std::filesystem::path& path,
	bool allow_existing
) {
	const DWORD attributes = GetFileAttributesW(path.c_str());
	if (attributes != INVALID_FILE_ATTRIBUTES)
		return allow_existing &&
			(attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 &&
			(attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;

	if (CreateDirectoryW(path.c_str(), nullptr) != 0)
		return IsSafeDirectory(path);

	if (
		allow_existing &&
		GetLastError() == ERROR_ALREADY_EXISTS
	)
		return IsSafeDirectory(path);

	return false;
}

std::wstring NewGuidToken() {
	GUID guid{};
	if (FAILED(CoCreateGuid(&guid)))
		return {};

	wchar_t buffer[64]{};
	const int written = StringFromGUID2(
		guid,
		buffer,
		static_cast<int>(std::size(buffer))
	);
	if (written <= 0)
		return {};

	std::wstring token(buffer);
	token.erase(
		std::remove_if(
			token.begin(),
			token.end(),
			[](wchar_t character) {
				return character == L'{' ||
					character == L'}' ||
					character == L'-';
			}
		),
		token.end()
	);
	return token;
}

std::filesystem::path CreateFreshChildDirectory(
	const std::filesystem::path& parent,
	const wchar_t* prefix
) {
	for (std::size_t attempt = 0; attempt < 128; ++attempt) {
		const auto token = NewGuidToken();
		if (token.empty())
			return {};

		const auto candidate = parent /
			(std::wstring(prefix) + L"-" + token);
		if (CreateDirectoryW(candidate.c_str(), nullptr) != 0) {
			if (IsSafeDirectory(candidate))
				return candidate;

			std::error_code error;
			std::filesystem::remove_all(candidate, error);
			return {};
		}

		if (GetLastError() != ERROR_ALREADY_EXISTS)
			return {};
	}

	return {};
}

bool EnsureRelativeDirectoryTree(
	const std::filesystem::path& base,
	const std::filesystem::path& relative
) {
	if (!IsSafeDirectory(base) || relative.is_absolute())
		return false;

	auto current = base;
	for (const auto& component : relative) {
		const auto value = component.native();
		if (
			value == L"." ||
			value == L".." ||
			value.empty()
		)
			return false;

		current /= component;
		if (!EnsureDirectoryNoReparse(current, true))
			return false;
	}

	return true;
}

std::filesystem::path ProcessDropBaseDirectory() {
	static const std::filesystem::path process_directory = []() {
		wchar_t temp_path[MAX_PATH + 1]{};
		const DWORD length = GetTempPathW(MAX_PATH, temp_path);
		if (length == 0 || length > MAX_PATH)
			return std::filesystem::path{};

		const auto temp_directory = std::filesystem::path(temp_path);
		const auto app_directory = temp_directory / L"orqeto-dev";
		const auto native_drop_directory = app_directory / L"native-drop";
		if (
			!EnsureDirectoryNoReparse(app_directory, true) ||
			!EnsureDirectoryNoReparse(native_drop_directory, true)
		)
			return std::filesystem::path{};

		return CreateFreshChildDirectory(
			native_drop_directory,
			(L"process-" + std::to_wstring(GetCurrentProcessId())).c_str()
		);
	}();

	return process_directory;
}

std::filesystem::path CreateDropDirectory() {
	const auto process_directory = ProcessDropBaseDirectory();
	if (process_directory.empty() || !IsSafeDirectory(process_directory))
		return {};

	return CreateFreshChildDirectory(
		process_directory,
		L"drop"
	);
}


bool DescriptorFileName(
	const FILEDESCRIPTORW& descriptor,
	std::wstring* output
) {
	std::size_t length = 0;
	while (
		length < std::size(descriptor.cFileName) &&
		descriptor.cFileName[length] != L'\0'
	)
		++length;

	if (length == 0 || length == std::size(descriptor.cFileName))
		return false;

	output->assign(descriptor.cFileName, length);
	return true;
}

std::vector<std::filesystem::path> GetDescriptorPaths(
	IDataObject* data_object,
	std::vector<FILEDESCRIPTORW>* descriptors
) {
	std::vector<std::filesystem::path> paths;
	const CLIPFORMAT descriptor_format = static_cast<CLIPFORMAT>(
		RegisterClipboardFormatW(L"FileGroupDescriptorW")
	);
	FORMATETC format{
		descriptor_format,
		nullptr,
		DVASPECT_CONTENT,
		-1,
		TYMED_HGLOBAL,
	};
	STGMEDIUM medium{};

	if (FAILED(data_object->GetData(&format, &medium)))
		return paths;

	if (medium.tymed != TYMED_HGLOBAL || medium.hGlobal == nullptr) {
		ReleaseStgMedium(&medium);
		return paths;
	}

	const auto* group = static_cast<const FILEGROUPDESCRIPTORW*>(
		GlobalLock(medium.hGlobal)
	);
	if (group == nullptr) {
		ReleaseStgMedium(&medium);
		return paths;
	}

	const SIZE_T global_size = GlobalSize(medium.hGlobal);
	const SIZE_T header_size = offsetof(FILEGROUPDESCRIPTORW, fgd);
	if (global_size < header_size) {
		GlobalUnlock(medium.hGlobal);
		ReleaseStgMedium(&medium);
		return paths;
	}

	const UINT count = group->cItems;
	if (
		count > kMaxVirtualDropEntries ||
		static_cast<SIZE_T>(count) >
			(global_size - header_size) / sizeof(FILEDESCRIPTORW)
	) {
		GlobalUnlock(medium.hGlobal);
		ReleaseStgMedium(&medium);
		return paths;
	}

	descriptors->reserve(count);
	paths.reserve(count);

	for (UINT index = 0; index < count; ++index) {
		const FILEDESCRIPTORW descriptor = group->fgd[index];
		std::wstring file_name;
		std::filesystem::path relative_path;

		if (
			!DescriptorFileName(descriptor, &file_name) ||
			!SafeRelativePath(file_name, &relative_path)
		) {
			paths.clear();
			descriptors->clear();
			break;
		}

		descriptors->push_back(descriptor);
		paths.push_back(relative_path);
	}

	GlobalUnlock(medium.hGlobal);
	ReleaseStgMedium(&medium);
	return paths;
}

std::vector<std::filesystem::path> PathComponents(
	const std::filesystem::path& path
) {
	std::vector<std::filesystem::path> components;
	for (const auto& component : path) {
		if (!component.empty())
			components.push_back(component);
	}
	return components;
}

std::size_t SuffixPrefixOverlap(
	const std::filesystem::path& selected_path,
	const std::filesystem::path& descriptor_path
) {
	const auto selected = PathComponents(selected_path);
	const auto descriptor = PathComponents(descriptor_path);
	const auto maximum = std::min(selected.size(), descriptor.size());

	for (std::size_t length = maximum; length > 0; --length) {
		bool matches = true;
		for (std::size_t index = 0; index < length; ++index) {
			const auto& left = selected[selected.size() - length + index];
			const auto& right = descriptor[index];
			if (Lower(left.native()) != Lower(right.native())) {
				matches = false;
				break;
			}
		}

		if (matches)
			return length;
	}

	return 0;
}

std::filesystem::path RestoreSelectedAncestry(
	const std::filesystem::path& descriptor_path,
	const std::vector<SelectedInternalItem>& selected_items
) {
	const SelectedInternalItem* best_item = nullptr;
	std::size_t best_overlap = 0;
	bool ambiguous = false;

	for (const auto& item : selected_items) {
		const auto overlap = SuffixPrefixOverlap(
			item.path,
			descriptor_path
		);
		if (overlap > best_overlap) {
			best_item = &item;
			best_overlap = overlap;
			ambiguous = false;
		} else if (overlap > 0 && overlap == best_overlap) {
			ambiguous = true;
		}
	}

	if (best_item != nullptr && !ambiguous) {
		std::filesystem::path restored = best_item->path;
		const auto components = PathComponents(descriptor_path);
		for (std::size_t index = best_overlap; index < components.size(); ++index)
			restored /= components[index];
		return restored;
	}

	if (
		selected_items.size() == 1 &&
		selected_items.front().is_directory
	)
		return selected_items.front().path / descriptor_path;

	return descriptor_path;
}

bool WriteStreamToFile(
	IStream* stream,
	const std::filesystem::path& destination,
	std::uint64_t* total_bytes
) {
	std::ofstream output(destination, std::ios::binary | std::ios::trunc);
	if (!output)
		return false;

	std::vector<char> buffer(64 * 1024);
	while (true) {
		ULONG read = 0;
		const HRESULT result = stream->Read(
			buffer.data(),
			static_cast<ULONG>(buffer.size()),
			&read
		);
		if (FAILED(result))
			return false;
		if (read == 0)
			break;

		*total_bytes += read;
		if (*total_bytes > kMaxVirtualDropBytes)
			return false;

		output.write(buffer.data(), read);
		if (!output)
			return false;
	}

	return true;
}

bool WriteGlobalMemoryToFile(
	HGLOBAL memory,
	const std::filesystem::path& destination,
	std::uint64_t* total_bytes
) {
	const SIZE_T size = GlobalSize(memory);

	*total_bytes += size;
	if (*total_bytes > kMaxVirtualDropBytes)
		return false;

	std::ofstream output(destination, std::ios::binary | std::ios::trunc);
	if (!output)
		return false;

	if (size == 0)
		return true;

	const void* data = GlobalLock(memory);
	if (data == nullptr)
		return false;

	output.write(
		static_cast<const char*>(data),
		static_cast<std::streamsize>(size)
	);
	const bool success = static_cast<bool>(output);
	GlobalUnlock(memory);
	return success;
}

bool WriteVirtualFile(
	IDataObject* data_object,
	LONG index,
	CLIPFORMAT contents_format,
	const std::filesystem::path& destination,
	std::uint64_t* total_bytes
) {
	FORMATETC format{
		contents_format,
		nullptr,
		DVASPECT_CONTENT,
		index,
		TYMED_ISTREAM | TYMED_HGLOBAL,
	};
	STGMEDIUM medium{};

	if (FAILED(data_object->GetData(&format, &medium)))
		return false;

	bool success = false;
	if (medium.tymed == TYMED_ISTREAM && medium.pstm != nullptr) {
		success = WriteStreamToFile(
			medium.pstm,
			destination,
			total_bytes
		);
	} else if (medium.tymed == TYMED_HGLOBAL && medium.hGlobal != nullptr) {
		success = WriteGlobalMemoryToFile(
			medium.hGlobal,
			destination,
			total_bytes
		);
	}

	ReleaseStgMedium(&medium);
	return success;
}

bool MaterializeVirtualDrop(
	IDataObject* data_object,
	const std::vector<SelectedInternalItem>& selected_items,
	std::vector<std::wstring>* output_paths,
	std::wstring* output_root
) {
	std::vector<FILEDESCRIPTORW> descriptors;
	const auto descriptor_paths = GetDescriptorPaths(
		data_object,
		&descriptors
	);
	if (
		descriptor_paths.empty() ||
		descriptor_paths.size() != descriptors.size()
	)
		return false;

	std::vector<std::filesystem::path> restored_paths;
	restored_paths.reserve(descriptor_paths.size());

	for (const auto& descriptor_path : descriptor_paths)
		restored_paths.push_back(RestoreSelectedAncestry(
			descriptor_path,
			selected_items
		));

	const auto drop_directory = CreateDropDirectory();
	if (drop_directory.empty())
		return false;

	const CLIPFORMAT contents_format = static_cast<CLIPFORMAT>(
		RegisterClipboardFormatW(L"FileContents")
	);
	std::uint64_t total_bytes = 0;
	std::error_code filesystem_error;

	for (std::size_t index = 0; index < descriptors.size(); ++index) {
		const auto& descriptor = descriptors[index];
		const auto destination = drop_directory / restored_paths[index];

		if ((descriptor.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
			if (!EnsureRelativeDirectoryTree(
				drop_directory,
				restored_paths[index]
			)) {
				std::filesystem::remove_all(drop_directory, filesystem_error);
				return false;
			}
			continue;
		}

		if (
			!EnsureRelativeDirectoryTree(
				drop_directory,
				restored_paths[index].parent_path()
			) ||
			!WriteVirtualFile(
				data_object,
				static_cast<LONG>(index),
				contents_format,
				destination,
				&total_bytes
			)
		) {
			std::filesystem::remove_all(drop_directory, filesystem_error);
			return false;
		}
	}

	std::vector<std::filesystem::path> roots;
	if (!selected_items.empty()) {
		for (const auto& selected_item : selected_items) {
			const auto candidate = drop_directory / selected_item.path;
			if (std::filesystem::exists(candidate))
				roots.push_back(candidate);
		}
	}

	if (roots.empty()) {
		std::unordered_set<std::wstring> seen;
		for (const auto& restored : restored_paths) {
			const auto first = restored.begin();
			if (first == restored.end())
				continue;

			const auto key = Lower(first->native());
			if (seen.insert(key).second)
				roots.push_back(drop_directory / *first);
		}
	}

	if (roots.empty()) {
		std::filesystem::remove_all(drop_directory, filesystem_error);
		return false;
	}

	for (const auto& root : roots)
		output_paths->push_back(root.native());
	*output_root = drop_directory.native();
	return true;
}

bool GetPhysicalDropPaths(
	IDataObject* data_object,
	std::vector<std::wstring>* output_paths
) {
	FORMATETC format{
		CF_HDROP,
		nullptr,
		DVASPECT_CONTENT,
		-1,
		TYMED_HGLOBAL,
	};
	STGMEDIUM medium{};

	if (FAILED(data_object->GetData(&format, &medium)))
		return false;
	if (medium.tymed != TYMED_HGLOBAL || medium.hGlobal == nullptr) {
		ReleaseStgMedium(&medium);
		return false;
	}

	const HDROP drop = reinterpret_cast<HDROP>(medium.hGlobal);
	const UINT count = DragQueryFileW(drop, 0xFFFFFFFF, nullptr, 0);
	if (count == 0 || count > kMaxPhysicalDropEntries) {
		ReleaseStgMedium(&medium);
		return false;
	}

	std::size_t total_characters = 0;
	output_paths->reserve(count);
	for (UINT index = 0; index < count; ++index) {
		const UINT length = DragQueryFileW(drop, index, nullptr, 0);
		if (length == 0 || length > kMaxDropPathCharacters) {
			output_paths->clear();
			ReleaseStgMedium(&medium);
			return false;
		}
		total_characters += length;
		if (total_characters > kMaxPhysicalDropCharacters) {
			output_paths->clear();
			ReleaseStgMedium(&medium);
			return false;
		}

		std::wstring path(length + 1, L'\0');
		if (DragQueryFileW(drop, index, path.data(), length + 1) != length) {
			output_paths->clear();
			ReleaseStgMedium(&medium);
			return false;
		}
		path.resize(length);
		output_paths->push_back(std::move(path));
	}

	ReleaseStgMedium(&medium);
	return !output_paths->empty();
}

bool SupportsVirtualDrop(IDataObject* data_object) {
	const CLIPFORMAT descriptor_format = static_cast<CLIPFORMAT>(
		RegisterClipboardFormatW(L"FileGroupDescriptorW")
	);
	FORMATETC format{
		descriptor_format,
		nullptr,
		DVASPECT_CONTENT,
		-1,
		TYMED_HGLOBAL,
	};
	return SUCCEEDED(data_object->QueryGetData(&format));
}

bool SupportsPhysicalDrop(IDataObject* data_object) {
	FORMATETC format{
		CF_HDROP,
		nullptr,
		DVASPECT_CONTENT,
		-1,
		TYMED_HGLOBAL,
	};
	return SUCCEEDED(data_object->QueryGetData(&format));
}

void Emit(
	std::uint32_t event,
	HWND hwnd,
	POINTL screen_position,
	const std::vector<std::wstring>& paths = {},
	const std::wstring& temporary_root = L""
) {
	if (g_callback == nullptr)
		return;

	POINT position{
		screen_position.x,
		screen_position.y,
	};
	const HWND coordinate_window = g_parent != nullptr ?
		g_parent :
		hwnd;
	ScreenToClient(coordinate_window, &position);

	std::vector<const wchar_t*> raw_paths;
	raw_paths.reserve(paths.size());
	for (const auto& path : paths)
		raw_paths.push_back(path.c_str());

	g_callback(
		event,
		position.x,
		position.y,
		raw_paths.data(),
		raw_paths.size(),
		temporary_root.empty() ? nullptr : temporary_root.c_str()
	);
}

class DropTarget final : public IDropTarget {
public:
	explicit DropTarget(HWND hwnd) : hwnd_(hwnd) {}

	HRESULT STDMETHODCALLTYPE QueryInterface(
		REFIID iid,
		void** object
	) override {
		if (object == nullptr)
			return E_POINTER;

		if (iid == IID_IUnknown || iid == IID_IDropTarget) {
			*object = static_cast<IDropTarget*>(this);
			AddRef();
			return S_OK;
		}

		*object = nullptr;
		return E_NOINTERFACE;
	}

	ULONG STDMETHODCALLTYPE AddRef() override {
		return ++references_;
	}

	ULONG STDMETHODCALLTYPE Release() override {
		const ULONG remaining = --references_;
		if (remaining == 0)
			delete this;
		return remaining;
	}

	HRESULT STDMETHODCALLTYPE DragEnter(
		IDataObject* data_object,
		DWORD,
		POINTL position,
		DWORD* effect
	) override {
		valid_ = data_object != nullptr && (
			SupportsPhysicalDrop(data_object) ||
			SupportsVirtualDrop(data_object)
		);
		*effect = valid_ ? DROPEFFECT_COPY : DROPEFFECT_NONE;

		if (valid_)
			Emit(kEventEnter, hwnd_, position);

		return S_OK;
	}

	HRESULT STDMETHODCALLTYPE DragOver(
		DWORD,
		POINTL position,
		DWORD* effect
	) override {
		*effect = valid_ ? DROPEFFECT_COPY : DROPEFFECT_NONE;
		if (valid_)
			Emit(kEventOver, hwnd_, position);
		return S_OK;
	}

	HRESULT STDMETHODCALLTYPE DragLeave() override {
		if (valid_)
			Emit(kEventLeave, hwnd_, POINTL{});
		valid_ = false;
		return S_OK;
	}

	HRESULT STDMETHODCALLTYPE Drop(
		IDataObject* data_object,
		DWORD,
		POINTL position,
		DWORD* effect
	) override {
		if (!valid_ || data_object == nullptr) {
			*effect = DROPEFFECT_NONE;
			return S_OK;
		}

		std::vector<std::wstring> paths;
		std::wstring temporary_root;
		const auto selected_internal_items = SelectedInternalItems(data_object);
		const bool prefer_virtual = !selected_internal_items.empty();
		bool success = false;

		if (prefer_virtual) {
			success = MaterializeVirtualDrop(
				data_object,
				selected_internal_items,
				&paths,
				&temporary_root
			);
		}

		if (!success) {
			paths.clear();
			temporary_root.clear();
			success = GetPhysicalDropPaths(data_object, &paths);
		}

		if (!success && !prefer_virtual) {
			paths.clear();
			success = MaterializeVirtualDrop(
				data_object,
				selected_internal_items,
				&paths,
				&temporary_root
			);
		}

		*effect = success ? DROPEFFECT_COPY : DROPEFFECT_NONE;
		if (success)
			Emit(kEventDrop, hwnd_, position, paths, temporary_root);
		else
			Emit(kEventLeave, hwnd_, position);

		valid_ = false;
		return S_OK;
	}

private:
	std::atomic<ULONG> references_{1};
	HWND hwnd_;
	bool valid_ = false;
};

void ClearRegistrations() {
	for (const auto& registration : g_registrations) {
		RevokeDragDrop(registration.hwnd);
		registration.target->Release();
	}
	g_registrations.clear();
}

bool RegisterTarget(HWND hwnd) {
	if (hwnd == nullptr)
		return false;

	for (const auto& registration : g_registrations) {
		if (registration.hwnd == hwnd)
			return true;
	}

	auto* target = new DropTarget(hwnd);
	RevokeDragDrop(hwnd);
	const HRESULT result = RegisterDragDrop(hwnd, target);
	if (FAILED(result)) {
		target->Release();
		return false;
	}

	g_registrations.push_back({ hwnd, target });
	return true;
}

BOOL CALLBACK RegisterChildWindow(HWND hwnd, LPARAM) {
	RegisterTarget(hwnd);
	return TRUE;
}

bool RefreshTargets() {
	if (g_parent == nullptr)
		return false;

	ClearRegistrations();
	RegisterTarget(g_parent);
	EnumChildWindows(g_parent, RegisterChildWindow, 0);
	return !g_registrations.empty();
}
} // namespace

extern "C" __declspec(dllexport) bool orqeto_native_drop_install(
	HWND parent,
	DropCallback callback
) {
	if (parent == nullptr || callback == nullptr)
		return false;

	const HRESULT ole_result = OleInitialize(nullptr);
	if (FAILED(ole_result) && ole_result != RPC_E_CHANGED_MODE)
		return false;
	if (ole_result == RPC_E_CHANGED_MODE)
		return false;

	g_parent = parent;
	g_callback = callback;
	return RefreshTargets();
}

extern "C" __declspec(dllexport) bool orqeto_native_drop_refresh(HWND parent) {
	if (parent != nullptr)
		g_parent = parent;
	return RefreshTargets();
}
