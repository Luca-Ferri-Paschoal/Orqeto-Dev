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

