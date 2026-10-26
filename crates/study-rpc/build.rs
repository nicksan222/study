fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    let mut prost = tonic_prost_build::Config::new();
    prost.protoc_executable(protoc);
    tonic_prost_build::configure()
        .type_attribute(".", "#[derive(serde::Serialize, serde::Deserialize)]")
        .file_descriptor_set_path(
            std::path::PathBuf::from(std::env::var("OUT_DIR")?).join("study_descriptor.bin"),
        )
        .compile_with_config(prost, &["proto/study/v1/study.proto"], &["proto"])?;
    println!("cargo:rerun-if-changed=proto/study/v1/study.proto");
    Ok(())
}
