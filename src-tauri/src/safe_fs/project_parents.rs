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

