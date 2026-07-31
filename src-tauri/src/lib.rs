// Petición al hub desde el lado NATIVO (Rust/reqwest): sin CORS, sin Origin de browser → pasa el gate del hub como el mobile.
// La UI (webview) llama a este comando por IPC. El sid de sesión viene en el body de /api/auth; se manda como header Cookie.
#[tauri::command]
async fn hub_fetch(url: String, method: String, body: Option<String>, cookie: Option<String>) -> Result<serde_json::Value, String> {
  let client = reqwest::Client::builder()
    .user_agent("Pipe-Desktop")
    .build()
    .map_err(|e| e.to_string())?;
  let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
  let mut req = client.request(m, &url).header("Content-Type", "application/json");
  if let Some(c) = cookie {
    if !c.is_empty() { req = req.header("Cookie", format!("sid={}", c)); }
  }
  if let Some(b) = body { req = req.body(b); }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  let status = resp.status().as_u16();
  let text = resp.text().await.map_err(|e| e.to_string())?;
  Ok(serde_json::json!({ "status": status, "body": text }))
}

// Sube BINARIO al hub (nota de voz / adjunto): recibe el cuerpo en base64 desde el webview, lo decodifica y POSTea bytes crudos
// con el Content-Type real (audio/ogg, image/jpeg, …). Sin esto la desktop no podría mandar audios ni archivos (hub_fetch es solo texto).
#[tauri::command]
async fn hub_upload(url: String, method: String, content_type: String, body_b64: String, cookie: Option<String>) -> Result<serde_json::Value, String> {
  use base64::Engine;
  let bytes = base64::engine::general_purpose::STANDARD.decode(body_b64.as_bytes()).map_err(|e| e.to_string())?;
  let client = reqwest::Client::builder().user_agent("Pipe-Desktop").build().map_err(|e| e.to_string())?;
  let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
  let mut req = client.request(m, &url).header("Content-Type", content_type).body(bytes);
  if let Some(c) = cookie {
    if !c.is_empty() { req = req.header("Cookie", format!("sid={}", c)); }
  }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  let status = resp.status().as_u16();
  let text = resp.text().await.map_err(|e| e.to_string())?;
  Ok(serde_json::json!({ "status": status, "body": text }))
}

// Baja una imagen del hub (avatar/foto) autenticada y la devuelve como data URI → el <img> la muestra sin CORS ni cookies del webview.
#[tauri::command]
async fn hub_image(url: String, cookie: Option<String>) -> Result<String, String> {
  let client = reqwest::Client::builder().user_agent("Pipe-Desktop").build().map_err(|e| e.to_string())?;
  let mut req = client.get(&url);
  if let Some(c) = cookie {
    if !c.is_empty() { req = req.header("Cookie", format!("sid={}", c)); }
  }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
  let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").to_string();
  let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
  use base64::Engine;
  let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
  Ok(format!("data:{};base64,{}", ct, b64))
}

// Lee un archivo LOCAL (el export de WhatsApp que el usuario elige con el diálogo nativo) y lo devuelve en base64.
// La UI lo reenvía por hub_upload como cuerpo crudo. Usa std::fs directo (no el plugin fs) → no necesita scope de capabilities.
#[tauri::command]
fn read_file_b64(path: String) -> Result<String, String> {
  use base64::Engine;
  let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
  Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

// Abre una URL en el navegador del sistema (los links de los mensajes deben salir del webview, no navegar dentro de la app).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
  if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) { return Err("url no permitida".into()); }
  #[cfg(target_os = "macos")] let r = std::process::Command::new("open").arg(&url).spawn();
  #[cfg(target_os = "windows")] let r = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn();
  #[cfg(target_os = "linux")] let r = std::process::Command::new("xdg-open").arg(&url).spawn();
  r.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())          // diálogo nativo para elegir el archivo de WhatsApp
    .plugin(tauri_plugin_notification::init())    // notificaciones locales del SO al llegar un mensaje nuevo
    .invoke_handler(tauri::generate_handler![hub_fetch, hub_upload, hub_image, open_url, read_file_b64])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
