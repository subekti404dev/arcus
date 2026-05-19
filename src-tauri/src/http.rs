use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Deserialize)]
pub struct HeaderInput {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct HttpRequestInput {
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderInput>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponseOutput {
    pub status: u16,
    pub status_text: String,
    pub duration_ms: u128,
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

    if let Some(body) = input.body {
        if !body.is_empty() {
            request = request.body(body);
        }
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
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
    let body = response.text().await.map_err(|err| err.to_string())?;

    Ok(HttpResponseOutput {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        duration_ms: started_at.elapsed().as_millis(),
        headers,
        body,
    })
}
