//! Generates only transport dispatch: every operation is a call on the generated tonic client.
use std::{env, fs, path::PathBuf};

fn snake(name: &str) -> String {
    let mut out = String::new();
    for (index, ch) in name.chars().enumerate() {
        if index > 0 && ch.is_uppercase() {
            out.push('_');
        }
        out.extend(ch.to_lowercase());
    }
    out
}

fn main() {
    let proto = "../../crates/study-rpc/proto/study/v1/study.proto";
    println!("cargo:rerun-if-changed={proto}");
    let schema = fs::read_to_string(proto).expect("canonical Study protobuf schema");
    let mut path_messages = std::collections::HashSet::new();
    let mut message = "";
    for line in schema.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix("message ") {
            message = name.split_whitespace().next().expect("message name");
        }
        let words: Vec<_> = line.split_whitespace().collect();
        let field = if words.first() == Some(&"repeated") {
            words.get(2)
        } else if words.first() == Some(&"string") {
            words.get(1)
        } else {
            None
        };
        if field.is_some_and(|field| ["path", "paths", "files", "destination"].contains(field)) {
            path_messages.insert(message);
        }
    }
    let mut output = String::from(
        "pub async fn unary(mut client: Client, method: &str, payload: &[u8], session: &crate::fixture::Session) -> Result<Vec<u8>, Status> { match method {\n",
    );
    for line in schema
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("rpc "))
    {
        let words: Vec<_> = line.split_whitespace().collect();
        if line.contains("stream ") {
            continue;
        }
        let method = words[1];
        let request = words[2]
            .trim_matches(['(', ')'])
            .trim_start_matches(".study.v1.");
        if path_messages.contains(request)
            && ![
                "ImportFileRequest",
                "ImportFilesRequest",
                "PostMessageRequest",
                "ExportSourceToFileRequest",
            ]
            .contains(&request)
        {
            panic!(
                "path-bearing RPC request {request} needs an explicit browser filesystem policy"
            );
        }
        let policy = match request {
            "ImportFileRequest" => {
                "let files = session.files.lock().await; let arena = files.as_ref().ok_or_else(|| Status::not_found(\"fixture session closed\"))?; request.path = arena.readable(&request.path)?;"
            }
            "ImportFilesRequest" => {
                "let files = session.files.lock().await; let arena = files.as_ref().ok_or_else(|| Status::not_found(\"fixture session closed\"))?; request.paths = request.paths.iter().map(|path| arena.readable(path)).collect::<Result<_,_>>()?;"
            }
            "PostMessageRequest" => {
                "let files = session.files.lock().await; let arena = files.as_ref().ok_or_else(|| Status::not_found(\"fixture session closed\"))?; request.files = request.files.iter().map(|path| arena.readable(path)).collect::<Result<_,_>>()?;"
            }
            "ExportSourceToFileRequest" => {
                output.push_str(&format!("\"study.v1.Study/{method}\" => Err(Status::permission_denied(\"browser exports use ExportSource bytes, never filesystem destinations\")),\n"));
                continue;
            }
            _ => "",
        };
        let mutable = if policy.is_empty() { "" } else { "mut " };
        output.push_str(&format!(
            "\"study.v1.Study/{method}\" => {{ let {mutable}request = p::{request}::decode(payload).map_err(|_| Status::invalid_argument(\"malformed protobuf request\"))?; {policy} let response = client.{}(request).await?.into_inner(); Ok(response.encode_to_vec()) }},\n", snake(method)
        ));
    }
    output.push_str("_ => Err(Status::unimplemented(\"unknown unary RPC method\")), } }\n");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("dispatch.rs"),
        output,
    )
    .expect("write dispatch");
}
