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

