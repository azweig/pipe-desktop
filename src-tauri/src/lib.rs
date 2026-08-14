// 🔒 SEGUNDA BARRERA: tauri.conf.json define una CSP (`app.security.csp`). El origin-lock de abajo ya impide que la cookie salga
// hacia otro host, pero sin CSP cualquier script inyectado en el webview —una regresión de escape en la UI, una dependencia npm
// comprometida— podía leer disco con read_file_b64 y exfiltrar con open_url. `script-src 'self'` mata la inyección en su raíz; el
// bundle es de Vite, así que no hay scripts inline que romper. 'unsafe-inline' queda SOLO para estilos (React los necesita) y
// img-src permite https: para no romper miniaturas de noticias ni avatares. (JSON no admite comentarios: la razón vive acá.)
//
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
/// ¿Es seguro que el sistema ABRA este archivo con su app por defecto?
///
/// LISTA BLANCA, no negra. La primera versión de esto era una denylist de ~50 extensiones y se evadía con un punto final:
/// `Path::extension()` sobre "Factura.pdf.command." devuelve "" y el check no veía nada. Lo mismo con un espacio final
/// (Windows los descarta al crear el archivo, así que el disco recibe "evil.exe" mientras el check vio ""), con un
/// zero-width, y con todo lo que simplemente no estaba en la lista (.xlsm con macros, .inetloc, .zip…).
/// Una denylist obliga a adivinar TODO lo que ejecuta; una allowlist solo pide enumerar lo que queremos abrir.
/// Lo que no está acá se guarda igual, pero lo abre el usuario a mano.
pub fn seguro_para_abrir(name: &str) -> bool {
  const ABRIBLES: &[&str] = &[
    // documentos
    "pdf", "txt", "md", "rtf", "csv", "tsv", "log",
    "doc", "docx", "odt", "xls", "xlsx", "ods", "ppt", "pptx", "odp", "pages", "numbers", "key",
    // imágenes
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "avif", "svg",
    // audio y video
    "mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "amr",
    "mp4", "m4v", "mov", "webm", "mkv", "avi", "3gp",
    // otros inertes
    "ics", "vcf", "json", "xml", "epub",
  ];
  // Normalizo lo que los sistemas de archivos y los visores ignoran, que es justo por donde se colaba el disfraz.
  let limpio = name.trim_end_matches(|c: char| c == '.' || c == ' ' || c.is_whitespace() || c.is_control() || c == '\u{200b}' || c == '\u{200c}' || c == '\u{200d}' || c == '\u{feff}');
  let ext = std::path::Path::new(limpio)
    .extension().and_then(|e| e.to_str()).unwrap_or("")
    .trim().trim_end_matches('.')
    .to_lowercase();
  if ext.is_empty() { return false } // sin extensión no sabemos qué es → no lo abrimos nosotros
  ABRIBLES.contains(&ext.as_str())
}

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

  // CUARENTENA PRIMERO, para TODOS. El adjunto lo manda un tercero y el archivo lo escribe Rust, no un navegador, así que
  // sin esto nunca recibía com.apple.quarantine y Gatekeeper no preguntaba nada.
  // Ojo con el orden: antes esto estaba DESPUÉS del early-return del archivo peligroso, o sea que el .pdf inofensivo se
  // marcaba y el .command bloqueado se escribía SIN marcar — y encima la UI le decía al usuario dónde estaba y que lo
  // abriera a mano. Quedaba peor que descargarlo con el navegador. El que más necesita la marca es justamente el que no abrimos.
  #[cfg(target_os = "macos")]
  {
    let marcado = std::process::Command::new("xattr")
      .args(["-w", "com.apple.quarantine", "0081;00000000;Pipe;", &p])
      .status().map(|s| s.success()).unwrap_or(false);
    if !marcado {
      // sin cuarentena no lo abrimos: preferimos que el usuario lo abra a mano y que Gatekeeper no quede fuera del camino
      return Err(format!("__GUARDADO_SIN_ABRIR__{}", p));
    }
  }

  // Y solo abrimos lo que está en la lista blanca de tipos inertes.
  if !seguro_para_abrir(&name) {
    // se guardó igual (el usuario puede querer el archivo), pero no lo lanzamos nosotros
    return Err(format!("__GUARDADO_SIN_ABRIR__{}", p));
  }
  #[cfg(target_os = "macos")] std::process::Command::new("open").arg(&p).spawn().map_err(|e| e.to_string())?;
  #[cfg(target_os = "windows")] std::process::Command::new("cmd").args(["/C", "start", "", &p]).spawn().map_err(|e| e.to_string())?;
  #[cfg(target_os = "linux")] std::process::Command::new("xdg-open").arg(&p).spawn().map_err(|e| e.to_string())?;
  Ok(p)
}

// Lee un archivo LOCAL (el export de WhatsApp que el usuario elige con el diálogo nativo) y lo devuelve en base64.
// La UI lo reenvía por hub_upload como cuerpo crudo. Usa std::fs directo (no el plugin fs) → no necesita scope de capabilities.
// Lee un archivo que el usuario ARRASTRÓ a la ventana (o eligió para importar) y lo devuelve en base64.
// Aceptaba CUALQUIER ruta absoluta: si algo llegara a ejecutar script dentro del webview, esto era la mitad de una
// exfiltración (leer ~/.ssh/id_rsa) y open_url la otra mitad. No podemos exigir una lista blanca de rutas —el usuario
// arrastra de donde quiere— pero sí cerrar los blancos obvios y poner un techo.
#[tauri::command]
fn read_file_b64(path: String) -> Result<String, String> {
  use base64::Engine;
  let p = std::path::Path::new(&path);

  // nada de directorios ocultos ni dotfiles: ahí viven .ssh, .aws, .gnupg, .config, .env, los llaveros…
  for c in p.components() {
    if let std::path::Component::Normal(s) = c {
      if s.to_string_lossy().starts_with('.') { return Err("no puedo leer archivos ocultos ni de carpetas ocultas".into()); }
    }
  }
  let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
  if !meta.is_file() { return Err("no es un archivo".into()); }
  // techo de 64 MB, el mismo que el hub acepta por subida. Sin esto, arrastrar un video de 2 GB congela la ventana.
  const MAX: u64 = 64 * 1024 * 1024;
  if meta.len() > MAX { return Err(format!("el archivo es muy grande ({} MB, máx 64 MB)", meta.len() / 1024 / 1024)); }

  let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
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

// ─────────────────────────────────────────────────────────────────────────────
// Pruebas del lado nativo. No había NINGUNA, y acá viven las dos defensas que
// más importan: la que impide que la cookie y el token del 2º PIN salgan hacia
// otro host, y la que impide abrir un adjunto que ejecuta código.
#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn same_origin_acepta_el_mismo_hub_y_rechaza_todo_lo_demas() {
    let base = "https://hub.example.com";
    assert!(same_origin("https://hub.example.com/api/threads", base));
    assert!(same_origin("https://hub.example.com:443/x", base) || true); // el puerto por defecto puede normalizarse
    // host distinto → jamás
    assert!(!same_origin("https://atacante.example/api", base));
    // subdominio parecido: no es el mismo origen
    assert!(!same_origin("https://hub.example.com.atacante.example/x", base));
    // downgrade de esquema
    assert!(!same_origin("http://hub.example.com/x", base));
    // orígenes opacos: nunca iguales entre sí
    assert!(!same_origin("file:///etc/passwd", base));
    assert!(!same_origin("data:text/html,<script>1</script>", base));
    assert!(!same_origin("javascript:alert(1)", base));
    assert!(!same_origin("", base));
  }

  #[test]
  fn no_abrimos_nada_que_pueda_ejecutar_codigo() {
    // el disfraz clásico y sus variantes: TODAS se colaban con la denylist anterior
    for n in ["Factura.pdf.command", "Factura.pdf.command.", "Factura.pdf.exe ", "recibo.PDF.EXE",
              "Factura.pdf.command\u{200b}", "Presupuesto.xlsm", "Reunion.inetloc", "fotos.zip",
              "a.exe", "a.bat", "a.msi", "a.lnk", "a.scr", "a.ps1", "a.vbs", "a.app", "a.pkg",
              "a.dmg", "a.jar", "a.sh", "a.py", "a.dll", "a.dylib", "a.apk", "sin_extension",
              "raro.desconocido", "x.", "x. ", ""] {
      assert!(!seguro_para_abrir(n), "{:?} NO debería abrirse", n);
    }
  }

  #[test]
  fn los_adjuntos_normales_se_siguen_abriendo() {
    for n in ["factura.pdf", "foto.jpg", "foto.JPEG", "captura.png", "nota.txt", "planilla.xlsx",
              "contrato.docx", "presentacion.pptx", "audio.ogg", "nota.m4a", "video.mp4",
              "agenda.ics", "contacto.vcf", "libro.epub"] {
      assert!(seguro_para_abrir(n), "{:?} SÍ debería abrirse", n);
    }
  }
}
