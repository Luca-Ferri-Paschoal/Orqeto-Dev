const MAX_ZIP_ENTRIES: usize = 50_000;
const MAX_ZIP_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_AMBIGUOUS_DESTINATIONS: usize = 10;
const MAX_ROUTING_CANDIDATE_VALIDATIONS: usize = 12;
const MAX_SOURCE_CONTEXT_SEGMENTS: usize = 8;
const ZIP_SOURCE_PREFIX_PENALTY_PER_SEGMENT: usize = 12;
const DELETE_MANIFEST_FILE_NAME: &str = ".orqeto-dev-delete.json";
const DELETE_MANIFEST_FORMAT: &str = "orqeto-dev-delete";
const DELETE_MANIFEST_VERSION: u32 = 1;
const MAX_DELETE_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_DELETE_MANIFEST_PATHS: usize = 10_000;
const MIN_UNDO_HISTORY_ENTRIES: usize = 1;
const MAX_UNDO_HISTORY_ENTRIES: usize = 100;
const UNDO_HISTORY_FILE_NAME: &str = ".orqeto-undo-history.json";
const UNDO_HISTORY_FORMAT: &str = "orqeto-dev-undo-history";
const UNDO_HISTORY_VERSION: u32 = 1;
const MAX_UNDO_HISTORY_METADATA_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayDestinationCandidate {
	destination_relative_path: String,
	source_prefix: String,
	matched_files: usize,
	matched_directories: usize,
	source_context_matches: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareProjectOverlayResult {
	file_count: usize,
	delete_count: usize,
	permanent_delete_paths: Vec<String>,
	candidates: Vec<OverlayDestinationCandidate>,
	root_candidate: Option<OverlayDestinationCandidate>,
	recommended_candidate_index: Option<usize>,
	candidate_count: usize,
	ambiguity_limit: usize,
	ambiguity_limit_exceeded: bool,
	source_fingerprint: String,
	routing_fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretReviewFile {
    path: String,
    operation: String,
    source_detections: usize,
    destination_detections: usize,
    approvable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretReviewResult {
    files: Vec<SecretReviewFile>,
    fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProjectOverlayResult {
	pub(crate) operation_id: String,
	pub(crate) applied_at_unix_ms: Option<u64>,
	pub(crate) added_files: usize,
	pub(crate) replaced_files: usize,
	pub(crate) deleted_files: usize,
	pub(crate) unchanged_files: usize,
	pub(crate) added_directories: usize,
	pub(crate) replaced_directories: usize,
	pub(crate) deleted_directories: usize,
	pub(crate) unchanged_directories: usize,
	pub(crate) protected_secret_files: usize,
	pub(crate) detected_secrets: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoProjectOverlayResult {
	operation_id: String,
	restored_files: usize,
	removed_files: usize,
	undone_batches: usize,
	remaining_history_entries: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayUndoHistoryEntry {
	operation_id: String,
	steps: usize,
	added_files: usize,
	replaced_files: usize,
	deleted_files: usize,
	applied_at_unix_ms: u64,
	source_kind: String,
	source_label: Option<String>,
	added_lines: Option<usize>,
	deleted_lines: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedSourceHistoryMatch {
	kind: String,
	applications_ago: Option<usize>,
	source_label: Option<String>,
	currently_applied: bool,
}

struct ManifestFile {
	relative_path: PathBuf,
	source: ManifestFileSource,
}

enum ManifestFileSource {
	Directory(PathBuf),
	Zip(usize),
}

enum ManifestKind {
	Directory {
		source_root: PathBuf,
		source_context: Vec<String>,
		source_components: Vec<String>,
		source_name: String,
	},
	File {
		source_file: PathBuf,
		source_context: Vec<String>,
		source_components: Vec<String>,
		source_name: String,
	},
	Zip {
		archive_path: PathBuf,
	},
}

struct OverlayManifest {
	kind: ManifestKind,
	files: Vec<ManifestFile>,
	delete_paths: Vec<PathBuf>,
	delete_directories: Vec<PathBuf>,
	permanent_delete_directories: Vec<PathBuf>,
	common_directory_prefixes: Vec<PathBuf>,
}

struct DeleteManifestPlan {
	files: Vec<PathBuf>,
	directories: Vec<PathBuf>,
	permanent_directories: Vec<PathBuf>,
}

struct FrozenOverlayInput {
	root: PathBuf,
	manifest: OverlayManifest,
	staging_directory: PathBuf,
}

impl Drop for FrozenOverlayInput {
	fn drop(&mut self) {
		let _ = storage::remove_managed_directory(&self.staging_directory);
	}
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteManifestDocument {
	format: String,
	version: u32,
	delete: Vec<String>,
	#[serde(rename = "deletePermanent", default)]
	delete_permanent: Vec<String>,
}

#[derive(Clone)]
struct CandidatePlan {
	candidate: OverlayDestinationCandidate,
	destination_relative_path: PathBuf,
	source_prefix: PathBuf,
	score: usize,
	mapping_key: Vec<String>,
	is_named_destination: bool,
}

#[derive(Clone)]
struct PlannedFile {
	destination_relative_path: PathBuf,
	source_index: usize,
	was_replaced: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FileFingerprint {
	pub(crate) size: u64,
	pub(crate) hash: [u8; 32],
}

#[derive(Clone, Serialize, Deserialize)]
enum UndoFileKind {
	Created,
	Replaced {
		backup_path: PathBuf,
		backup_blob_id: Option<String>,
	},
}

#[derive(Clone, Serialize, Deserialize)]
struct UndoFile {
	destination_relative_path: PathBuf,
	kind: UndoFileKind,
	applied_fingerprint: Option<FileFingerprint>,
	recovery_applied: bool,
	recovery_allowed_states: Vec<Option<FileFingerprint>>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum UndoSourceKind {
	Files,
	Git,
}

impl UndoSourceKind {
	fn as_str(self) -> &'static str {
		match self {
			Self::Files => "files",
			Self::Git => "git",
		}
	}
}
