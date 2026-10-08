use std::{
	fs,
	path::{Path, PathBuf},
	time::{SystemTime, UNIX_EPOCH},
};

pub(crate) fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
	fs::canonicalize(path)
		.map_err(|error| format!("Could not access {}: {error}", path.display()))
}

pub(crate) fn current_unix_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
		.unwrap_or(0)
}

pub(crate) fn encode_hex(bytes: &[u8]) -> String {
	const HEX: &[u8; 16] = b"0123456789abcdef";
	let mut output = String::with_capacity(bytes.len() * 2);
	for byte in bytes {
		output.push(HEX[(byte >> 4) as usize] as char);
		output.push(HEX[(byte & 0x0f) as usize] as char);
	}
	output
}

pub(crate) fn resolve_from_path(executable: &str) -> Option<PathBuf> {
	let path = std::env::var_os("PATH")?;
	for directory in std::env::split_paths(&path) {
		let candidate = directory.join(executable);
		if candidate.is_file() {
			if let Ok(canonical) = fs::canonicalize(&candidate) {
				return Some(canonical);
			}
		}
	}
	None
}
