#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn br_res_001_budget_accepts_values_at_the_limit() {
		let limits = TraversalLimits::new(
			2,
			1,
			3,
			64,
			256,
		);
		let mut budget = TraversalBudget::default();

		budget.record_file(limits).expect("first file");
		budget.record_file(limits).expect("second file");
		budget.record_directory(limits).expect("directory");
		budget.record_entry(limits).expect("first entry");
		budget.record_entry(limits).expect("second entry");
		budget.record_entry(limits).expect("third entry");
		budget
			.record_path(Path::new("short/path"), limits)
			.expect("short path");
	}

	#[test]
	fn br_res_002_budget_rejects_the_first_value_over_each_limit() {
		let limits = TraversalLimits::new(
			1,
			1,
			1,
			4,
			8,
		);

		let mut files = TraversalBudget::default();
		files.record_file(limits).expect("file at limit");
		assert_eq!(
			files.record_file(limits),
			Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::Files,
				limit: 1,
			}),
		);

		let mut directories = TraversalBudget::default();
		directories.record_directory(limits).expect("directory at limit");
		assert_eq!(
			directories.record_directory(limits),
			Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::Directories,
				limit: 1,
			}),
		);

		let mut entries = TraversalBudget::default();
		entries.record_entry(limits).expect("entry at limit");
		assert_eq!(
			entries.record_entry(limits),
			Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::Entries,
				limit: 1,
			}),
		);

		assert_eq!(
			TraversalBudget::default().record_path(Path::new("12345"), limits),
			Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::PathBytes,
				limit: 4,
			}),
		);

		let aggregate_test_path = Path::new("123");
		let one_path_bytes = platform_path_bytes(aggregate_test_path);
		let aggregate_limit = one_path_bytes
			.saturating_mul(2)
			.saturating_sub(1);
		let total_path_limits = TraversalLimits::new(
			1,
			1,
			1,
			one_path_bytes,
			aggregate_limit,
		);
		let mut path_bytes = TraversalBudget::default();
		path_bytes
			.record_path(aggregate_test_path, total_path_limits)
			.expect("first path is within aggregate path budget");
		assert_eq!(
			path_bytes.record_path(aggregate_test_path, total_path_limits),
			Err(TraversalLimitExceeded {
				kind: TraversalLimitKind::TotalPathBytes,
				limit: aggregate_limit,
			}),
		);
	}

	#[test]
	fn br_res_003_large_project_ceiling_values_are_stable() {
		assert_eq!(PROJECT_DISCOVERY_MAX_FILES, 500_000);
		assert_eq!(PROJECT_DISCOVERY_MAX_DIRECTORIES, 1_000_000);
		assert_eq!(PROJECT_DISCOVERY_MAX_ENTRIES, 1_500_000);
		assert_eq!(
			PROJECT_DISCOVERY_MAX_FILES + PROJECT_DISCOVERY_MAX_DIRECTORIES,
			PROJECT_DISCOVERY_MAX_ENTRIES,
		);
	}

	#[test]
	fn br_res_004_large_ceiling_and_limit_plus_one_are_bounded_without_allocation() {
		let mut files = TraversalBudget::default();
		for _ in 0..PROJECT_DISCOVERY_MAX_FILES {
			files
				.record_file(PROJECT_DISCOVERY_LIMITS)
				.expect("file within project ceiling");
		}
		assert!(files.record_file(PROJECT_DISCOVERY_LIMITS).is_err());

		let mut directories = TraversalBudget::default();
		for _ in 0..PROJECT_DISCOVERY_MAX_DIRECTORIES {
			directories
				.record_directory(PROJECT_DISCOVERY_LIMITS)
				.expect("directory within project ceiling");
		}
		assert!(directories.record_directory(PROJECT_DISCOVERY_LIMITS).is_err());

		let mut entries = TraversalBudget::default();
		for _ in 0..PROJECT_DISCOVERY_MAX_ENTRIES {
			entries
				.record_entry(PROJECT_DISCOVERY_LIMITS)
				.expect("entry within project ceiling");
		}
		assert!(entries.record_entry(PROJECT_DISCOVERY_LIMITS).is_err());
	}

	#[test]
	fn br_res_005_machine_policy_caps_parallelism_and_buffer_size() {
		let policy = machine_resource_policy();
		assert!((1..=MAX_BACKGROUND_IO_WORKERS).contains(&policy.worker_count));
		assert_eq!(policy.stream_buffer_bytes, STREAM_BUFFER_BYTES);
		assert!(policy.stream_buffer_bytes <= 1024 * 1024);
	}

	#[test]
	fn br_res_006_generated_scale_tiers_keep_budget_state_constant_size() {
		for file_tier in [1_000_usize, 10_000, 50_000, 100_000, 500_000] {
			let mut budget = TraversalBudget::default();
			for _ in 0..file_tier {
				budget
					.record_file(PROJECT_DISCOVERY_LIMITS)
					.expect("generated file tier should remain within ceiling");
			}
		}

		for directory_tier in [10_000_usize, 100_000, 500_000, 1_000_000] {
			let mut budget = TraversalBudget::default();
			for _ in 0..directory_tier {
				budget
					.record_directory(PROJECT_DISCOVERY_LIMITS)
					.expect("generated directory tier should remain within ceiling");
			}
		}
	}

}
