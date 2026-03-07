// vite.config.ts
import { defineConfig } from "file:///D:/work/react/operatorPannel-main/node_modules/vite/dist/node/index.js";
import path from "node:path";
import electron from "file:///D:/work/react/operatorPannel-main/node_modules/vite-plugin-electron/dist/simple.mjs";
import react from "file:///D:/work/react/operatorPannel-main/node_modules/@vitejs/plugin-react/dist/index.js";
var __vite_injected_original_dirname = "D:\\work\\react\\operatorPannel-main";
var vite_config_default = defineConfig({
  server: {
    hmr: {
      overlay: true
    }
  },
  build: {
    // Prevent Vite from adding crossorigin attributes to script/link tags.
    // In Electron production (file:// protocol), crossorigin causes CORS failures
    // because file:// has an opaque (null) origin.
    modulePreload: false
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2020"
    }
  },
  esbuild: {
    target: "es2020"
  },
  plugins: [
    react(),
    // Strip `crossorigin` attributes from built HTML.
    // Electron production loads from file:// protocol where CORS is inapplicable
    // and crossorigin can cause opaque-origin failures in some Chromium builds.
    {
      name: "electron-strip-crossorigin",
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, "");
      }
    },
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts"
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__vite_injected_original_dirname, "electron/preload.ts"),
        vite: {
          build: {
            rollupOptions: {
              output: {
                format: "es",
                entryFileNames: "preload.mjs"
              }
            }
          }
        }
      },
      // Polyfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === "test" ? void 0 : {}
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFx3b3JrXFxcXHJlYWN0XFxcXG9wZXJhdG9yUGFubmVsLW1haW5cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXHdvcmtcXFxccmVhY3RcXFxcb3BlcmF0b3JQYW5uZWwtbWFpblxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDovd29yay9yZWFjdC9vcGVyYXRvclBhbm5lbC1tYWluL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCBlbGVjdHJvbiBmcm9tICd2aXRlLXBsdWdpbi1lbGVjdHJvbi9zaW1wbGUnXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnXG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBzZXJ2ZXI6IHtcbiAgICBobXI6IHtcbiAgICAgIG92ZXJsYXk6IHRydWUsXG4gICAgfSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICAvLyBQcmV2ZW50IFZpdGUgZnJvbSBhZGRpbmcgY3Jvc3NvcmlnaW4gYXR0cmlidXRlcyB0byBzY3JpcHQvbGluayB0YWdzLlxuICAgIC8vIEluIEVsZWN0cm9uIHByb2R1Y3Rpb24gKGZpbGU6Ly8gcHJvdG9jb2wpLCBjcm9zc29yaWdpbiBjYXVzZXMgQ09SUyBmYWlsdXJlc1xuICAgIC8vIGJlY2F1c2UgZmlsZTovLyBoYXMgYW4gb3BhcXVlIChudWxsKSBvcmlnaW4uXG4gICAgbW9kdWxlUHJlbG9hZDogZmFsc2UsXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGVzYnVpbGRPcHRpb25zOiB7XG4gICAgICB0YXJnZXQ6ICdlczIwMjAnLFxuICAgIH0sXG4gIH0sXG4gIGVzYnVpbGQ6IHtcbiAgICB0YXJnZXQ6ICdlczIwMjAnLFxuICB9LFxuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICAvLyBTdHJpcCBgY3Jvc3NvcmlnaW5gIGF0dHJpYnV0ZXMgZnJvbSBidWlsdCBIVE1MLlxuICAgIC8vIEVsZWN0cm9uIHByb2R1Y3Rpb24gbG9hZHMgZnJvbSBmaWxlOi8vIHByb3RvY29sIHdoZXJlIENPUlMgaXMgaW5hcHBsaWNhYmxlXG4gICAgLy8gYW5kIGNyb3Nzb3JpZ2luIGNhbiBjYXVzZSBvcGFxdWUtb3JpZ2luIGZhaWx1cmVzIGluIHNvbWUgQ2hyb21pdW0gYnVpbGRzLlxuICAgIHtcbiAgICAgIG5hbWU6ICdlbGVjdHJvbi1zdHJpcC1jcm9zc29yaWdpbicsXG4gICAgICB0cmFuc2Zvcm1JbmRleEh0bWwoaHRtbDogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBodG1sLnJlcGxhY2UoLyBjcm9zc29yaWdpbi9nLCAnJylcbiAgICAgIH0sXG4gICAgfSxcbiAgICBlbGVjdHJvbih7XG4gICAgICBtYWluOiB7XG4gICAgICAgIC8vIFNob3J0Y3V0IG9mIGBidWlsZC5saWIuZW50cnlgLlxuICAgICAgICBlbnRyeTogJ2VsZWN0cm9uL21haW4udHMnLFxuICAgICAgfSxcbiAgICAgIHByZWxvYWQ6IHtcbiAgICAgICAgLy8gU2hvcnRjdXQgb2YgYGJ1aWxkLnJvbGx1cE9wdGlvbnMuaW5wdXRgLlxuICAgICAgICAvLyBQcmVsb2FkIHNjcmlwdHMgbWF5IGNvbnRhaW4gV2ViIGFzc2V0cywgc28gdXNlIHRoZSBgYnVpbGQucm9sbHVwT3B0aW9ucy5pbnB1dGAgaW5zdGVhZCBgYnVpbGQubGliLmVudHJ5YC5cbiAgICAgICAgaW5wdXQ6IHBhdGguam9pbihfX2Rpcm5hbWUsICdlbGVjdHJvbi9wcmVsb2FkLnRzJyksXG4gICAgICAgIHZpdGU6IHtcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgICAgICAgICBvdXRwdXQ6IHtcbiAgICAgICAgICAgICAgICBmb3JtYXQ6ICdlcycsXG4gICAgICAgICAgICAgICAgZW50cnlGaWxlTmFtZXM6ICdwcmVsb2FkLm1qcycsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgLy8gUG9seWZpbGwgdGhlIEVsZWN0cm9uIGFuZCBOb2RlLmpzIEFQSSBmb3IgUmVuZGVyZXIgcHJvY2Vzcy5cbiAgICAgIC8vIElmIHlvdSB3YW50IHVzZSBOb2RlLmpzIGluIFJlbmRlcmVyIHByb2Nlc3MsIHRoZSBgbm9kZUludGVncmF0aW9uYCBuZWVkcyB0byBiZSBlbmFibGVkIGluIHRoZSBNYWluIHByb2Nlc3MuXG4gICAgICAvLyBTZWUgXHVEODNEXHVEQzQ5IGh0dHBzOi8vZ2l0aHViLmNvbS9lbGVjdHJvbi12aXRlL3ZpdGUtcGx1Z2luLWVsZWN0cm9uLXJlbmRlcmVyXG4gICAgICByZW5kZXJlcjogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICd0ZXN0J1xuICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vZWxlY3Ryb24tdml0ZS92aXRlLXBsdWdpbi1lbGVjdHJvbi1yZW5kZXJlci9pc3N1ZXMvNzgjaXNzdWVjb21tZW50LTIwNTM2MDA4MDhcbiAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgOiB7fSxcbiAgICB9KSxcbiAgXSxcbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTZSLFNBQVMsb0JBQW9CO0FBQzFULE9BQU8sVUFBVTtBQUNqQixPQUFPLGNBQWM7QUFDckIsT0FBTyxXQUFXO0FBSGxCLElBQU0sbUNBQW1DO0FBTXpDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFFBQVE7QUFBQSxJQUNOLEtBQUs7QUFBQSxNQUNILFNBQVM7QUFBQSxJQUNYO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTztBQUFBO0FBQUE7QUFBQTtBQUFBLElBSUwsZUFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixnQkFBZ0I7QUFBQSxNQUNkLFFBQVE7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsUUFBUTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUlOO0FBQUEsTUFDRSxNQUFNO0FBQUEsTUFDTixtQkFBbUIsTUFBYztBQUMvQixlQUFPLEtBQUssUUFBUSxpQkFBaUIsRUFBRTtBQUFBLE1BQ3pDO0FBQUEsSUFDRjtBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1AsTUFBTTtBQUFBO0FBQUEsUUFFSixPQUFPO0FBQUEsTUFDVDtBQUFBLE1BQ0EsU0FBUztBQUFBO0FBQUE7QUFBQSxRQUdQLE9BQU8sS0FBSyxLQUFLLGtDQUFXLHFCQUFxQjtBQUFBLFFBQ2pELE1BQU07QUFBQSxVQUNKLE9BQU87QUFBQSxZQUNMLGVBQWU7QUFBQSxjQUNiLFFBQVE7QUFBQSxnQkFDTixRQUFRO0FBQUEsZ0JBQ1IsZ0JBQWdCO0FBQUEsY0FDbEI7QUFBQSxZQUNGO0FBQUEsVUFDRjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFJQSxVQUFVLFFBQVEsSUFBSSxhQUFhLFNBRS9CLFNBQ0EsQ0FBQztBQUFBLElBQ1AsQ0FBQztBQUFBLEVBQ0g7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
