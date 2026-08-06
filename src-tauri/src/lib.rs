// 🔒 SEGURIDAD: los comandos que adjuntan la cookie de sesión + el token del 2º PIN SOLO pueden hablar con el hub configurado (`base`).
// Sin esto, una URL absoluta metida en un mensaje (path de media/adjunto) haría que el lado nativo POSTee el token secreto a un host
// atacante. Comparamos el ORIGIN (esquema+host+puerto): dos orígenes opacos (file:/data:) nunca son iguales → quedan rechazados.
fn same_origin(url: &str, base: &str) -> bool {
  match (reqwest::Url::parse(url), reqwest::Url::parse(base)) {
    (Ok(u), Ok(b)) => u.origin() == b.origin(),
    _ => false,
  }
}

// Petición al hub desde el lado NATIVO (Rust/reqwest): sin CORS, sin Origin de browser → pasa el gate del hub como el mobile.
// La UI (webview) llama a este comando por IPC. El sid de sesión viene en el body de /api/auth; se manda como header Cookie.
#[tauri::command]
async fn hub_fetch(url: String, base: String, method: String, body: Option<String>, cookie: Option<String>, secret: Option<String>) -> Result<serde_json::Value, String> {
  if !same_origin(&url, &base) { return Err("destino no permitido (solo el hub configurado)".into()); }
  let client = reqwest::Client::builder()
    .user_agent("Pipe-Desktop")
    .build()
    .map_err(|e| e.to_string())?;
  let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
  let mut req = client.request(m, &url).header("Content-Type", "application/json");
  if let Some(c) = cookie {
    if !c.is_empty() { req = req.header("Cookie", format!("sid={}", c)); }
  }
  // 🔒 CUENTAS SECRETAS: el token del 2º PIN viaja SIEMPRE por el lado nativo (nunca en fetch del webview). Solo cuando está desbloqueado.
  if let Some(s) = secret {
    if !s.is_empty() { req = req.header("x-secret-token", s); }
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
async fn hub_upload(url: String, base: String, method: String, content_type: String, body_b64: String, cookie: Option<String>, secret: Option<String>) -> Result<serde_json::Value, String> {
  if !same_origin(&url, &base) { return Err("destino no permitido (solo el hub configurado)".into()); }
  use base64::Engine;
  let bytes = base64::engine::general_purpose::STANDARD.decode(body_b64.as_bytes()).map_err(|e| e.to_string())?;
  let client = reqwest::Client::builder().user_agent("Pipe-Desktop").build().map_err(|e| e.to_string())?;
  let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
  let mut req = client.request(m, &url).header("Content-Type", content_type).body(bytes);
  if let Some(c) = cookie {
    if !c.is_empty() { req = req.header("Cookie", format!("sid={}", c)); }
  }
  // 🔒 CUENTAS SECRETAS: mismo token del 2º PIN en las subidas binarias (audio/adjuntos), solo mientras esté desbloqueado.
  if let Some(s) = secret {
    if !s.is_empty() { req = req.header("x-secret-token", s); }
  }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  let status = resp.status().as_u16();
  let text = resp.text().await.map_err(|e| e.to_string())?;
  Ok(serde_json::json!({ "status": status, "body": text }))
}

// Baja una imagen del hub (avatar/foto) autenticada y la devuelve como data URI → el <img> la muestra sin CORS ni cookies del webview.
#[tauri::command]
async fn hub_image(url: String, base: String, cookie: Option<String>) -> Result<String, String> {
  if !same_origin(&url, &base) { return Err("destino no permitido (solo el hub configurado)".into()); }
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

// Baja un ARCHIVO/DOCUMENTO del hub (autenticado), lo guarda en una carpeta temporal con su nombre real y lo ABRE con la app
// por defecto del SO (Vista Previa/Word/Excel/…). Espejo de hub_image pero para cualquier tipo (pdf/docx/xlsx/…): el webview no
// puede descargar con la cookie de sesión, así que la descarga+apertura la hace el lado nativo. Devuelve la ruta del archivo.
#[tauri::command]
async fn hub_open_file(url: String, base: String, filename: Option<String>, cookie: Option<String>) -> Result<String, String> {
  if !same_origin(&url, &base) { return Err("destino no permitido (solo el hub configurado)".into()); }
  let client = reqwest::Client::builder().user_agent("Pipe-Desktop").build().map_err(|e| e.to_string())?;
  let mut req = client.get(&url);
  if let Some(c) = cookie {
    if !c.is_empty() { req = req.header("Cookie", format!("sid={}", c)); }
  }
  let resp = req.send().await.map_err(|e| e.to_string())?;
  if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
  // nombre: el que pasó la UI; si no, el de Content-Disposition; si no, "documento"
  let mut name = filename.unwrap_or_default().trim().to_string();
  if name.is_empty() {
    if let Some(cd) = resp.headers().get("content-disposition").and_then(|v| v.to_str().ok()) {
      if let Some(i) = cd.find("filename=") { name = cd[i + 9..].trim_matches(|c| c == '"' || c == ' ' || c == ';').to_string(); }
    }
  }
  if name.is_empty() { name = "documento".to_string(); }
  // saneo del nombre para el sistema de archivos + quita guiones/puntos iniciales (evita dotfiles, "..", arg-injection en open/xdg-open)
  let name: String = name.chars().map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
  let name = name.trim_start_matches(['-', '.', ' ']).to_string();
  let name = if name.is_empty() { "documento".to_string() } else { name };
  let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
  let mut path = std::env::temp_dir();
  path.push("pipe-downloads");
  std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  path.push(&name);
  std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
  let p = path.to_string_lossy().to_string();
  #[cfg(target_os = "macos")] std::process::Command::new("open").arg(&p).spawn().map_err(|e| e.to_string())?;
  #[cfg(target_os = "windows")] std::process::Command::new("cmd").args(["/C", "start", "", &p]).spawn().map_err(|e| e.to_string())?;
  #[cfg(target_os = "linux")] std::process::Command::new("xdg-open").arg(&p).spawn().map_err(|e| e.to_string())?;
  Ok(p)
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
    .invoke_handler(tauri::generate_handler![hub_fetch, hub_upload, hub_image, hub_open_file, open_url, read_file_b64])
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
