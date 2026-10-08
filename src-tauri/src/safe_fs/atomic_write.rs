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


