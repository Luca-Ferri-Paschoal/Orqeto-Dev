use std::{
	fs::{self, File, OpenOptions},
	io::{self, Read, Write},
	path::{Path, PathBuf},
	sync::atomic::{AtomicU64, Ordering},
};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn metadata_is_link_or_reparse(metadata: &fs::Metadata) -> bool {
	#[cfg(target_os = "windows")]
	{
		use std::os::windows::fs::MetadataExt;

		const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

		metadata.file_type().is_symlink() ||
			(metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
	}

	#[cfg(not(target_os = "windows"))]
	{
		metadata.file_type().is_symlink()
	}
}

pub fn validate_project_relative_path(
	root: &Path,
	relative: &Path,
) -> Result<(), String> {
	if relative.as_os_str().is_empty() || relative.is_absolute() {
		return Err("The project-relative path is invalid.".to_string());
	}

	let components = relative.components().collect::<Vec<_>>();
	let component_count = components.len();
	let mut current = root.to_path_buf();
	for (index, component) in components.into_iter().enumerate() {
		let std::path::Component::Normal(name) = component else {
			return Err(format!(
				"Path {} contains an unsafe component.",
				relative.display(),
			));
		};

		#[cfg(target_os = "windows")]
		validate_windows_component(name)?;

		current.push(name);

		#[cfg(target_os = "windows")]
		validate_windows_existing_spelling(&current, name)?;

		match fs::symlink_metadata(&current) {
			Ok(metadata) => {
				if metadata_is_link_or_reparse(&metadata) {
					return Err(format!(
						"Path {} crosses a symbolic link or reparse point and was rejected for safety.",
						current.display(),
					));
				}

				let is_last = index + 1 == component_count;
				if !is_last && !metadata.is_dir() {
					return Err(format!(
						"Path {} uses an intermediate component that is not a directory.",
						current.display(),
					));
				}
			}
			Err(error) if error.kind() == io::ErrorKind::NotFound => {}
			Err(error) => {
				return Err(format!(
					"Could not safely validate {}: {error}",
					current.display(),
				));
			}
		}
	}

	Ok(())
}

#[cfg(target_os = "windows")]
fn validate_windows_component(name: &std::ffi::OsStr) -> Result<(), String> {
	let value = name
		.to_str()
		.ok_or_else(|| "The path contains a name that cannot be represented safely on Windows.".to_string())?;
	if value.ends_with('.') || value.ends_with(' ') {
		return Err(format!(
			"Name {value} ends with a dot or space and is ambiguous on Windows.",
		));
	}
	if value.contains(':') {
		return Err(format!(
			"O nome {value} usa ':' e poderia acessar um Alternate Data Stream no Windows.",
		));
	}

	let device_base = value
		.split('.')
		.next()
		.unwrap_or(value)
		.trim_end_matches(|character| character == ' ' || character == '.')
		.to_ascii_uppercase();
	let reserved = matches!(
		device_base.as_str(),
		"CON" |
			"PRN" |
			"AUX" |
			"NUL" |
			"CLOCK$" |
			"CONIN$" |
			"CONOUT$" |
			"COM1" |
			"COM2" |
			"COM3" |
			"COM4" |
			"COM5" |
			"COM6" |
			"COM7" |
			"COM8" |
			"COM9" |
			"COM¹" |
			"COM²" |
			"COM³" |
			"LPT1" |
			"LPT2" |
			"LPT3" |
			"LPT4" |
			"LPT5" |
			"LPT6" |
			"LPT7" |
			"LPT8" |
			"LPT9" |
			"LPT¹" |
			"LPT²" |
			"LPT³"
	);
	if reserved {
		return Err(format!(
			"Name {value} is reserved by Windows and cannot be used as a project path.",
		));
	}

	Ok(())
}

#[cfg(target_os = "windows")]
fn validate_windows_existing_spelling(
	path: &Path,
	requested_name: &std::ffi::OsStr,
) -> Result<(), String> {
	use std::{ffi::OsStr, os::windows::ffi::{OsStrExt, OsStringExt}};

	match fs::symlink_metadata(path) {
		Ok(_) => {}
		Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
		Err(error) => {
			return Err(format!(
				"Could not validate the Windows name for {}: {error}",
				path.display(),
			));
		}
	}

	#[link(name = "kernel32")]
	extern "system" {
		fn GetLongPathNameW(
			lpsz_short_path: *const u16,
			lpsz_long_path: *mut u16,
			cch_buffer: u32,
		) -> u32;
	}

	fn wide(value: &OsStr) -> Vec<u16> {
		value.encode_wide().chain(std::iter::once(0)).collect()
	}

	let source = wide(path.as_os_str());
	let required = unsafe { GetLongPathNameW(source.as_ptr(), std::ptr::null_mut(), 0) };
	if required == 0 {
		return Err(format!(
			"Could not resolve the long name for {}: {}",
			path.display(),
			io::Error::last_os_error(),
		));
	}
	let mut buffer = vec![0_u16; required as usize + 1];
	let written = unsafe {
		GetLongPathNameW(
			source.as_ptr(),
			buffer.as_mut_ptr(),
			buffer.len() as u32,
		)
	};
	if written == 0 {
		return Err(format!(
			"Could not resolve the long name for {}: {}",
			path.display(),
			io::Error::last_os_error(),
		));
	}
	buffer.truncate(written as usize);
	let long_path = PathBuf::from(std::ffi::OsString::from_wide(&buffer));
	let Some(long_name) = long_path.file_name() else {
		return Ok(());
	};
	let requested = requested_name.to_string_lossy();
	let long = long_name.to_string_lossy();
	if !requested.eq_ignore_ascii_case(&long) {
		return Err(format!(
			"Path {} uses an alternate/8.3 spelling ({requested}) for the existing name {long} and was rejected for safety.",
			path.display(),
		));
	}

	Ok(())
}

fn canonical_parent_for_mutation(destination: &Path) -> io::Result<PathBuf> {
	let parent = destination
		.parent()
		.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "destination has no parent"))?;
	let metadata = fs::symlink_metadata(parent)?;
	if metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
		return Err(io::Error::new(
			io::ErrorKind::InvalidInput,
			"destination parent is not a stable directory",
		));
	}
	fs::canonicalize(parent)
}

fn ensure_parent_unchanged(
	destination: &Path,
	expected_parent: &Path,
) -> io::Result<()> {
	let current_parent = canonical_parent_for_mutation(destination)?;
	if current_parent != expected_parent {
		return Err(io::Error::new(
			io::ErrorKind::Other,
			"destination parent changed while the file operation was in progress",
		));
	}
	Ok(())
}

fn ensure_destination_not_symlink(destination: &Path) -> io::Result<()> {
	match fs::symlink_metadata(destination) {
		Ok(metadata) if metadata_is_link_or_reparse(&metadata) => Err(io::Error::new(
			io::ErrorKind::InvalidInput,
			"destination is a symbolic link or reparse point",
		)),
		Ok(_) => Ok(()),
		Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
		Err(error) => Err(error),
	}
}

fn temporary_sibling(destination: &Path) -> io::Result<(PathBuf, File)> {
	let parent = destination
		.parent()
		.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "destination has no parent"))?;
	let file_name = destination
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("file");

	for _ in 0..128 {
		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let candidate = parent.join(format!(
			".{file_name}.orqeto-tmp-{}-{nonce}",
			std::process::id(),
		));
		match OpenOptions::new()
			.write(true)
			.create_new(true)
			.open(&candidate)
		{
			Ok(file) => return Ok((candidate, file)),
			Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
			Err(error) => return Err(error),
		}
	}

	Err(io::Error::new(
		io::ErrorKind::AlreadyExists,
		"could not allocate a unique temporary file",
	))
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
	use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

	const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

	#[link(name = "kernel32")]
	extern "system" {
		fn MoveFileExW(
			lp_existing_file_name: *const u16,
			lp_new_file_name: *const u16,
			dw_flags: u32,
		) -> i32;
		fn ReplaceFileW(
			lp_replaced_file_name: *const u16,
			lp_replacement_file_name: *const u16,
			lp_backup_file_name: *const u16,
			dw_replace_flags: u32,
			lp_exclude: *mut std::ffi::c_void,
			lp_reserved: *mut std::ffi::c_void,
		) -> i32;
	}

	fn wide(value: &OsStr) -> Vec<u16> {
		value.encode_wide().chain(std::iter::once(0)).collect()
	}

	let source_wide = wide(source.as_os_str());
	let destination_wide = wide(destination.as_os_str());
	let result = if destination.exists() {
		unsafe {
			ReplaceFileW(
				destination_wide.as_ptr(),
				source_wide.as_ptr(),
				std::ptr::null(),
				0,
				std::ptr::null_mut(),
				std::ptr::null_mut(),
			)
		}
	} else {
		unsafe {
			MoveFileExW(
				source_wide.as_ptr(),
				destination_wide.as_ptr(),
				MOVEFILE_WRITE_THROUGH,
			)
		}
	};

	if result == 0 {
		Err(io::Error::last_os_error())
	} else {
		Ok(())
	}
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
	fs::rename(source, destination)
}

#[cfg(unix)]
pub fn sync_directory(path: &Path) -> io::Result<()> {
	File::open(path)?.sync_all()
}

#[cfg(not(unix))]
pub fn sync_directory(_path: &Path) -> io::Result<()> {
	Ok(())
}

fn sync_parent(path: &Path) -> io::Result<()> {
	let Some(parent) = path.parent() else {
		return Ok(());
	};
	sync_directory(parent)
}

pub fn create_dir_all_durable(path: &Path) -> io::Result<()> {
	if path.is_dir() {
		return Ok(());
	}

	let mut missing = Vec::new();
	let mut current = path;
	while !current.exists() {
		missing.push(current.to_path_buf());
		let Some(parent) = current.parent() else {
			break;
		};
		current = parent;
	}

	fs::create_dir_all(path)?;
	for directory in &missing {
		sync_directory(directory)?;
	}
	for directory in missing.iter().rev() {
		if let Some(parent) = directory.parent() {
			sync_directory(parent)?;
		}
	}
	Ok(())
}

fn stable_directory(path: &Path) -> io::Result<PathBuf> {
	let metadata = fs::symlink_metadata(path)?;
	if metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
		return Err(io::Error::new(
			io::ErrorKind::InvalidInput,
			"directory is not a stable non-reparse directory",
		));
	}
	fs::canonicalize(path)
}

pub fn create_descendant_directories_no_reparse(
	base: &Path,
	relative: &Path,
) -> io::Result<PathBuf> {
	if relative.is_absolute() {
		return Err(io::Error::new(
			io::ErrorKind::InvalidInput,
			"relative directory path must not be absolute",
		));
	}

	let base_canonical = stable_directory(base)?;
	let mut current_path = base.to_path_buf();
	let mut current_canonical = base_canonical.clone();

	for component in relative.components() {
		let std::path::Component::Normal(name) = component else {
			return Err(io::Error::new(
				io::ErrorKind::InvalidInput,
				"relative directory path contains an unsafe component",
			));
		};

		if stable_directory(&current_path)? != current_canonical {
			return Err(io::Error::new(
				io::ErrorKind::Other,
				"directory changed while descendants were being created",
			));
		}

		let next = current_path.join(name);
		match fs::symlink_metadata(&next) {
			Ok(metadata) => {
				if metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
					return Err(io::Error::new(
						io::ErrorKind::InvalidInput,
						"descendant is a symbolic link, reparse point, or non-directory",
					));
				}
			}
			Err(error) if error.kind() == io::ErrorKind::NotFound => {
				match fs::create_dir(&next) {
					Ok(()) => {
						sync_directory(&next)?;
						sync_directory(&current_path)?;
					}
					Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
					Err(error) => return Err(error),
				}
			}
			Err(error) => return Err(error),
		}

		let next_canonical = stable_directory(&next)?;
		if next_canonical.parent() != Some(current_canonical.as_path()) ||
			!next_canonical.starts_with(&base_canonical)
		{
			return Err(io::Error::new(
				io::ErrorKind::Other,
				"descendant escaped or changed while directories were being created",
			));
		}

		current_path = next;
		current_canonical = next_canonical;
	}

	Ok(current_path)
}

pub fn create_project_parent_directories(
	root: &Path,
	relative_file: &Path,
) -> io::Result<()> {
	validate_project_relative_path(
		root,
		relative_file,
	)
	.map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;

	let root_canonical = stable_directory(root)?;
	let parent_relative = relative_file.parent().unwrap_or_else(|| Path::new(""));
	let mut current_path = root.to_path_buf();
	let mut current_canonical = root_canonical.clone();

	for component in parent_relative.components() {
		let std::path::Component::Normal(name) = component else {
			return Err(io::Error::new(
				io::ErrorKind::InvalidInput,
				"project parent contains an unsafe path component",
			));
		};

		if stable_directory(&current_path)? != current_canonical {
			return Err(io::Error::new(
				io::ErrorKind::Other,
				"project parent changed while directories were being created",
			));
		}

		let next = current_path.join(name);
		match fs::symlink_metadata(&next) {
			Ok(metadata) => {
				if metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
					return Err(io::Error::new(
						io::ErrorKind::InvalidInput,
						"project parent is a symbolic link, reparse point, or non-directory",
					));
				}
			}
			Err(error) if error.kind() == io::ErrorKind::NotFound => {
				match fs::create_dir(&next) {
					Ok(()) => {
						sync_directory(&next)?;
						sync_directory(&current_path)?;
					}
					Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
					Err(error) => return Err(error),
				}
			}
			Err(error) => return Err(error),
		}

		let metadata = fs::symlink_metadata(&next)?;
		if metadata_is_link_or_reparse(&metadata) || !metadata.is_dir() {
			return Err(io::Error::new(
				io::ErrorKind::InvalidInput,
				"project parent became a symbolic link, reparse point, or non-directory",
			));
		}

		let next_canonical = fs::canonicalize(&next)?;
		if next_canonical.parent() != Some(current_canonical.as_path()) ||
			!next_canonical.starts_with(&root_canonical)
		{
			return Err(io::Error::new(
				io::ErrorKind::Other,
				"project parent escaped or changed while directories were being created",
			));
		}

		current_path = next;
		current_canonical = next_canonical;
	}

	Ok(())
}

#[cfg(target_os = "windows")]
fn commit_create_new(temporary: &Path, destination: &Path) -> io::Result<()> {
	use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

	const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

	#[link(name = "kernel32")]
	extern "system" {
		fn MoveFileExW(
			lp_existing_file_name: *const u16,
			lp_new_file_name: *const u16,
			dw_flags: u32,
		) -> i32;
	}

	fn wide(value: &OsStr) -> Vec<u16> {
		value.encode_wide().chain(std::iter::once(0)).collect()
	}

	let temporary_wide = wide(temporary.as_os_str());
	let destination_wide = wide(destination.as_os_str());
	let result = unsafe {
		MoveFileExW(
			temporary_wide.as_ptr(),
			destination_wide.as_ptr(),
			MOVEFILE_WRITE_THROUGH,
		)
	};

	if result == 0 {
		Err(io::Error::last_os_error())
	} else {
		Ok(())
	}
}

#[cfg(not(target_os = "windows"))]
fn commit_create_new(temporary: &Path, destination: &Path) -> io::Result<()> {
	// A hard link creates the destination atomically and fails if it already
	// exists. The temporary file lives beside the destination, so both names
	// are guaranteed to be on the same filesystem.
	fs::hard_link(temporary, destination)?;
	fs::remove_file(temporary)?;
	sync_parent(destination)
}

fn atomic_write_from_reader_with_permissions_checked<R, F>(
	destination: &Path,
	reader: &mut R,
	permissions: Option<fs::Permissions>,
	create_new: bool,
	mut before_commit: F,
) -> io::Result<u64>
where
	R: Read,
	F: FnMut() -> io::Result<()>,
{
	let parent = destination
		.parent()
		.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "destination has no parent"))?;
	create_dir_all_durable(parent)?;
	ensure_destination_not_symlink(destination)?;
	let expected_parent = canonical_parent_for_mutation(destination)?;
	let destination_permissions = if permissions.is_none() && destination.exists() {
		Some(fs::metadata(destination)?.permissions())
	} else {
		permissions
	};
	ensure_parent_unchanged(destination, &expected_parent)?;
	let (temporary, mut file) = temporary_sibling(destination)?;

	let result = (|| {
		let written = io::copy(reader, &mut file)?;
		file.flush()?;
		if let Some(permissions) = destination_permissions {
			fs::set_permissions(&temporary, permissions)?;
		}
		file.sync_all()?;
		drop(file);
		ensure_destination_not_symlink(destination)?;
		ensure_parent_unchanged(destination, &expected_parent)?;
		before_commit()?;
		ensure_destination_not_symlink(destination)?;
		ensure_parent_unchanged(destination, &expected_parent)?;
		if create_new {
			commit_create_new(&temporary, destination)?;
		} else {
			replace_file(&temporary, destination)?;
			sync_parent(destination)?;
		}
		Ok(written)
	})();

	if result.is_err() {
		let _ = fs::remove_file(&temporary);
	}

	result
}

fn atomic_write_from_reader_with_permissions<R: Read>(
	destination: &Path,
	reader: &mut R,
	permissions: Option<fs::Permissions>,
	create_new: bool,
) -> io::Result<u64> {
	atomic_write_from_reader_with_permissions_checked(
		destination,
		reader,
		permissions,
		create_new,
		|| Ok(()),
	)
}

pub fn atomic_write_from_reader<R: Read>(
	destination: &Path,
	reader: &mut R,
) -> io::Result<u64> {
	atomic_write_from_reader_with_permissions(
		destination,
		reader,
		None,
		false,
	)
}

pub fn atomic_copy_checked<F>(
	source: &Path,
	destination: &Path,
	before_commit: F,
) -> io::Result<u64>
where
	F: FnMut() -> io::Result<()>,
{
	let permissions = fs::metadata(source)?.permissions();
	let mut source_file = File::open(source)?;
	atomic_write_from_reader_with_permissions_checked(
		destination,
		&mut source_file,
		Some(permissions),
		false,
		before_commit,
	)
}

pub fn atomic_copy_preserve_destination_checked<F>(
	source: &Path,
	destination: &Path,
	before_commit: F,
) -> io::Result<u64>
where
	F: FnMut() -> io::Result<()>,
{
	let mut source_file = File::open(source)?;
	atomic_write_from_reader_with_permissions_checked(
		destination,
		&mut source_file,
		None,
		false,
		before_commit,
	)
}

pub fn atomic_write_from_reader_checked<R, F>(
	destination: &Path,
	reader: &mut R,
	before_commit: F,
) -> io::Result<u64>
where
	R: Read,
	F: FnMut() -> io::Result<()>,
{
	atomic_write_from_reader_with_permissions_checked(
		destination,
		reader,
		None,
		false,
		before_commit,
	)
}

pub fn atomic_write_bytes(destination: &Path, content: &[u8]) -> io::Result<()> {
	let mut reader = content;
	atomic_write_from_reader(destination, &mut reader).map(|_| ())
}

pub fn atomic_write_from_reader_create_new_checked<R, F>(
	destination: &Path,
	reader: &mut R,
	before_commit: F,
) -> io::Result<u64>
where
	R: Read,
	F: FnMut() -> io::Result<()>,
{
	atomic_write_from_reader_with_permissions_checked(
		destination,
		reader,
		None,
		true,
		before_commit,
	)
}

pub fn atomic_copy_create_new(source: &Path, destination: &Path) -> io::Result<u64> {
	let permissions = fs::metadata(source)?.permissions();
	let mut source_file = File::open(source)?;
	atomic_write_from_reader_with_permissions(
		destination,
		&mut source_file,
		Some(permissions),
		true,
	)
}

pub fn atomic_copy_create_new_checked<F>(
	source: &Path,
	destination: &Path,
	before_commit: F,
) -> io::Result<u64>
where
	F: FnMut() -> io::Result<()>,
{
	let permissions = fs::metadata(source)?.permissions();
	let mut source_file = File::open(source)?;
	atomic_write_from_reader_with_permissions_checked(
		destination,
		&mut source_file,
		Some(permissions),
		true,
		before_commit,
	)
}


#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn relative_path_validation_rejects_parent_components() {
		let root = std::env::temp_dir();
		assert!(validate_project_relative_path(&root, Path::new("../escape.txt")).is_err());
	}

	#[test]
	fn relative_path_validation_accepts_normal_nested_paths() {
		let root = std::env::temp_dir();
		assert!(validate_project_relative_path(&root, Path::new("src/components/App.tsx")).is_ok());
	}

	#[cfg(unix)]
	#[test]
	fn relative_path_validation_rejects_intermediate_symlinks() {
		use std::os::unix::fs::symlink;

		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		let outside = base.join("outside");
		fs::create_dir_all(&root).expect("root should be created");
		fs::create_dir_all(&outside).expect("outside should be created");
		symlink(&outside, root.join("linked")).expect("test symlink should be created");

		assert!(validate_project_relative_path(&root, Path::new("linked/file.txt")).is_err());
		fs::remove_dir_all(base).expect("test directory should be removed");
	}

	#[cfg(target_os = "windows")]
	#[test]
	fn windows_component_validation_rejects_aliases_and_ads() {
		for value in [
			"CON",
			"nul.txt",
			"COM1.log",
			"LPT9",
			"COM¹.txt",
			"LPT³.log",
			"file.txt:stream",
			"trailing.",
			"trailing ",
		] {
			assert!(
				validate_windows_component(std::ffi::OsStr::new(value)).is_err(),
				"{value} should be rejected on Windows",
			);
		}
	}
	#[test]
	fn br_fs_001_checked_atomic_replace_preserves_concurrent_destination_change() {
		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-checked-test-{}-{nonce}",
			std::process::id(),
		));
		fs::create_dir_all(&base).expect("test directory should be created");
		let source = base.join("source.txt");
		let destination = base.join("destination.txt");
		fs::write(&source, b"new").expect("source should be written");
		fs::write(&destination, b"old").expect("destination should be written");

		let result = atomic_copy_preserve_destination_checked(
			&source,
			&destination,
			|| {
				fs::write(&destination, b"external")?;
				let current = fs::read(&destination)?;
				if current != b"old" {
					return Err(io::Error::other(
						"destination changed before commit",
					));
				}
				Ok(())
			},
		);

		assert!(result.is_err());
		assert_eq!(
			fs::read(&destination).expect("destination should remain readable"),
			b"external",
		);
		let _ = fs::remove_dir_all(base);
	}

	#[test]
	fn br_fs_002_project_parent_creation_builds_only_under_the_canonical_root() {
		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-parent-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		fs::create_dir_all(&root).expect("root should be created");

		create_project_parent_directories(
			&root,
			Path::new("a/b/c/file.txt"),
		)
		.expect("nested project parents should be created");

		assert!(root.join("a/b/c").is_dir());
		let _ = fs::remove_dir_all(base);
	}

	#[cfg(unix)]
	#[test]
	fn project_parent_creation_rejects_intermediate_symlink_injection() {
		use std::os::unix::fs::symlink;

		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-parent-link-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		let outside = base.join("outside");
		fs::create_dir_all(&root).expect("root should be created");
		fs::create_dir_all(&outside).expect("outside should be created");
		symlink(&outside, root.join("linked")).expect("symlink should be created");

		assert!(
			create_project_parent_directories(
				&root,
				Path::new("linked/child/file.txt"),
			)
			.is_err(),
		);
		assert!(!outside.join("child").exists());
		let _ = fs::remove_dir_all(base);
	}

	#[cfg(target_os = "windows")]
	#[test]
	fn project_parent_creation_rejects_intermediate_reparse_injection() {
		use std::os::windows::fs::symlink_dir;

		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-parent-reparse-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		let outside = base.join("outside");
		let linked = root.join("linked");
		fs::create_dir_all(&root).expect("root should be created");
		fs::create_dir_all(&outside).expect("outside should be created");

		let linked_arg = linked.to_string_lossy().into_owned();
		let outside_arg = outside.to_string_lossy().into_owned();
		let linked_created = symlink_dir(&outside, &linked).is_ok() || {
			std::process::Command::new("cmd")
				.args([
					"/C",
					"mklink",
					"/J",
					linked_arg.as_str(),
					outside_arg.as_str(),
				])
				.status()
				.is_ok_and(|status| status.success())
		};

		if linked_created {
			assert!(
				create_project_parent_directories(
					&root,
					Path::new("linked/child/file.txt"),
				)
				.is_err(),
			);
			assert!(!outside.join("child").exists());
			let _ = fs::remove_dir(&linked);
		}

		let _ = fs::remove_dir_all(base);
	}


	#[cfg(target_os = "windows")]
	#[test]
	fn br_adv_004_windows_short_name_alias_is_rejected_when_available() {
		use std::{ffi::{OsStr, OsString}, os::windows::ffi::{OsStrExt, OsStringExt}};

		#[link(name = "kernel32")]
		extern "system" {
			fn GetShortPathNameW(
				lpsz_long_path: *const u16,
				lpsz_short_path: *mut u16,
				cch_buffer: u32,
			) -> u32;
		}

		fn wide(value: &OsStr) -> Vec<u16> {
			value.encode_wide().chain(std::iter::once(0)).collect()
		}

		let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
		let base = std::env::temp_dir().join(format!(
			"orqeto-safe-fs-short-name-test-{}-{nonce}",
			std::process::id(),
		));
		let root = base.join("root");
		fs::create_dir_all(&root).expect("root should be created");
		let long_name = "long-file-name-for-short-alias-test.txt";
		let file = root.join(long_name);
		fs::write(&file, b"alias").expect("test file should be written");

		let source = wide(file.as_os_str());
		let required = unsafe { GetShortPathNameW(source.as_ptr(), std::ptr::null_mut(), 0) };
		if required == 0 {
			let _ = fs::remove_dir_all(base);
			return;
		}
		let mut buffer = vec![0_u16; required as usize + 1];
		let written = unsafe { GetShortPathNameW(source.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32) };
		if written == 0 {
			let _ = fs::remove_dir_all(base);
			return;
		}
		let short_path = PathBuf::from(OsString::from_wide(&buffer[..written as usize]));
		let Some(short_name) = short_path.file_name() else {
			let _ = fs::remove_dir_all(base);
			return;
		};
		if short_name.to_string_lossy().eq_ignore_ascii_case(long_name) {
			let _ = fs::remove_dir_all(base);
			return;
		}

		assert!(validate_project_relative_path(&root, Path::new(short_name)).is_err());
		assert!(validate_project_relative_path(&root, Path::new("LONG-FILE-NAME-FOR-SHORT-ALIAS-TEST.TXT")).is_ok());
		let _ = fs::remove_dir_all(base);
	}

}
