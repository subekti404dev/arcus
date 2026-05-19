use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;
use tokio::fs;

#[derive(Debug, Deserialize)]
pub struct HeaderInput {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct FormField {
    pub key: String,
    pub value: String,
    #[serde(rename = "fieldType")]
    pub field_type: String, // "text" or "file"
}

#[derive(Debug, Deserialize)]
pub struct HttpRequestInput {
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderInput>,
    pub body: Option<String>,
    #[serde(rename = "formFields")]
    pub form_fields: Option<Vec<FormField>>,
}

#[derive(Debug, Serialize)]
pub struct TimingOutput {
    pub total_ms: u128,
    pub upload_ms: u128,
    pub download_ms: u128,
    pub first_byte_ms: u128,
    pub body_read_ms: u128,
}

#[derive(Debug, Serialize)]
pub struct HttpResponseOutput {
    pub status: u16,
    pub status_text: String,
    pub duration_ms: u128,
    pub timings: TimingOutput,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn send_http_request(input: HttpRequestInput) -> Result<HttpResponseOutput, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .zstd(true)
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|err| err.to_string())?;

    let method = input
        .method
        .parse::<reqwest::Method>()
        .map_err(|err| format!("Invalid method: {err}"))?;

    let mut header_map = HeaderMap::new();
    for header in input.headers {
        if header.key.trim().is_empty() {
            continue;
        }

        let lower = header.key.to_ascii_lowercase();
        if matches!(lower.as_str(), "connection" | "content-length" | "host") {
            continue;
        }

        let name = HeaderName::from_bytes(header.key.trim().as_bytes())
            .map_err(|err| format!("Invalid header `{}`: {err}", header.key))?;
        let value = HeaderValue::from_str(&header.value)
            .map_err(|err| format!("Invalid value for header `{}`: {err}", header.key))?;
        header_map.insert(name, value);
    }

    let started_at = Instant::now();
    let mut request = client.request(method, input.url).headers(header_map);

    if let Some(ref fields) = input.form_fields {
        if !fields.is_empty() {
            let mut form = multipart::Form::new();
            for field in fields {
                if !field.key.trim().is_empty() {
                    if field.field_type == "file" && !field.value.is_empty() {
                        let path = Path::new(&field.value);
                        if path.is_file() {
                            let file_bytes = fs::read(path).await.map_err(|err| format!("Cannot read `{}`: {err}", field.value))?;
                            let file_name = path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("file")
                                .to_string();
                            let mime = mime_guess::from_path(path).first_or_octet_stream();
                            let part = multipart::Part::bytes(file_bytes)
                                .file_name(file_name)
                                .mime_str(mime.as_ref())
                                .map_err(|err| format!("Invalid MIME for `{}`: {err}", field.value))?;
                            form = form.part(field.key.trim().to_string(), part);
                        }
                    } else {
                        form = form.text(field.key.trim().to_string(), field.value.clone());
                    }
                }
            }
            request = request.multipart(form);
        }
    } else if let Some(body) = input.body {
        if !body.is_empty() {
            request = request.body(body);
        }
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    let headers_received_at = Instant::now();
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| {
            (
                key.to_string(),
                value.to_str().unwrap_or("<non-utf8 header>").to_string(),
            )
        })
        .collect::<HashMap<_, _>>();
    let body_read_started_at = Instant::now();
    let body = response.text().await.map_err(|err| err.to_string())?;
    let completed_at = Instant::now();
    let first_byte_ms = headers_received_at.duration_since(started_at).as_millis();
    let body_read_ms = completed_at.duration_since(body_read_started_at).as_millis();
    let total_ms = completed_at.duration_since(started_at).as_millis();

    Ok(HttpResponseOutput {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        duration_ms: total_ms,
        timings: TimingOutput {
            total_ms,
            upload_ms: first_byte_ms,
            download_ms: body_read_ms,
            first_byte_ms,
            body_read_ms,
        },
        headers,
        body,
    })
}
