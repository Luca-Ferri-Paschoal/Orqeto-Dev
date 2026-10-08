include!("context_redaction/core.rs");
include!("context_redaction/url.rs");
include!("context_redaction/scan.rs");

#[cfg(test)]
mod tests {
	include!("context_redaction/tests.rs");
}
