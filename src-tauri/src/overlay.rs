use crate::{
	runtime_utils::{canonicalize_existing, current_unix_ms, encode_hex},
	operation_id::next_operation_id,
	project_ignore::ProjectIgnore,
	resource_limits::{
		machine_resource_policy,
		TraversalBudget,
		TraversalLimitExceeded,
		TraversalLimitKind,
		PROJECT_DISCOVERY_LIMITS,
	},
	safe_fs,
	storage,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
	collections::{HashMap, HashSet},
	fs::{self, File, OpenOptions},
	io::{BufRead, BufReader, Read},
	path::{Component, Path, PathBuf},
	sync::{Arc, Condvar, Mutex, OnceLock},
};
use tauri::State;

#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};
use zip::ZipArchive;

include!("overlay/model.rs");
include!("overlay/undo_types.rs");
include!("overlay/undo_state.rs");
include!("overlay/recovery_persistence.rs");
include!("overlay/recovery_validation.rs");
include!("overlay/recovery_startup.rs");
include!("overlay/manifest_permanent.rs");
include!("overlay/permanent_delete.rs");
include!("overlay/manifest_delete.rs");
include!("overlay/manifest_delete_directory.rs");
include!("overlay/manifest_directory.rs");
include!("overlay/manifest_file.rs");
include!("overlay/manifest_zip.rs");
include!("overlay/staging.rs");
include!("overlay/routing_discovery.rs");
include!("overlay/routing_scoring.rs");
include!("overlay/routing_root_hierarchy.rs");
include!("overlay/routing_pruning.rs");
include!("overlay/routing_candidates.rs");
include!("overlay/routing_recommendation.rs");
include!("overlay/prepare.rs");
include!("overlay/planning.rs");
include!("overlay/fingerprint.rs");
include!("overlay/content_compare.rs");
include!("overlay/secret_protection.rs");
include!("overlay/apply_backup.rs");
include!("overlay/apply_delete.rs");
include!("overlay/apply_write.rs");
include!("overlay/snapshot_cleanup.rs");
include!("overlay/external_undo.rs");
include!("overlay/external_undo_record.rs");
include!("overlay/apply_execution.rs");
include!("overlay/apply_wrapper.rs");
include!("overlay/undo_history.rs");
include!("overlay/undo_recovery.rs");
include!("overlay/public_apply.rs");
include!("overlay/source_history.rs");
include!("overlay/undo_sequence.rs");

#[cfg(test)]
mod tests {
	include!("overlay/tests/part_01.rs");
	include!("overlay/tests/part_02.rs");
	include!("overlay/tests/part_03.rs");
	include!("overlay/tests/part_04.rs");
	include!("overlay/tests/part_05.rs");
	include!("overlay/tests/part_06.rs");
	include!("overlay/tests/part_07.rs");
	include!("overlay/tests/part_08.rs");
	include!("overlay/tests/part_09.rs");
	include!("overlay/tests/part_10.rs");
	include!("overlay/tests/part_11.rs");
	include!("overlay/tests/part_12.rs");
    include!("overlay/tests/part_13.rs");
    include!("overlay/tests/part_14.rs");
    include!("overlay/tests/part_15.rs");
}
