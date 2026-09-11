fn main() {
	if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
		println!("cargo:rerun-if-changed=windows/native_drop.cpp");
		cc::Build::new()
			.cpp(true)
			.file("windows/native_drop.cpp")
			.flag_if_supported("/std:c++17")
			.compile("orqeto_native_drop");
	}

	tauri_build::build()
}
