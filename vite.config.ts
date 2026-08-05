import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// La app llama a /api/* (mismo origen que el dev server) y Vite lo proxya al hub. Así NO hay CORS y el hub recibe la request
// como si fuera de un cliente nativo (sin Origin de browser cross-site) → pasa el gate. La cookie de sesión se reescribe a localhost.
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5175,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: "localhost",
      },
      "/avatars": { target: "http://localhost:3000", changeOrigin: true },
      "/cas": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
})
