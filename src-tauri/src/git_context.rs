include!("git_context/model_and_limits.rs");
include!("git_context/bounded_process.rs");
include!("git_context/git_apply_execution.rs");
include!("git_context/repository_state.rs");
include!("git_context/commit_compare.rs");
include!("git_context/patch_metadata.rs");
include!("git_context/secret_protection.rs");
include!("git_context/numstat.rs");
include!("git_context/simulation.rs");
include!("git_context/patch_apply.rs");

#[cfg(test)]
include!("git_context/commit_compare_tests.rs");
