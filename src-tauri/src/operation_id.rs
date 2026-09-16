use std::{
	process,
	sync::atomic::{AtomicU64, Ordering},
	time::{SystemTime, UNIX_EPOCH},
};

static OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub(crate) fn next_operation_id(operation_type: &str) -> String {
	let unix_nanos = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|duration| duration.as_nanos())
		.unwrap_or_default();
	let sequence = OPERATION_SEQUENCE.fetch_add(
		1,
		Ordering::Relaxed,
	);

	format!(
		"{operation_type}:{}:{unix_nanos}:{sequence}",
		process::id(),
	)
}
