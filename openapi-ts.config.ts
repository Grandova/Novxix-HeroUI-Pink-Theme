import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: process.env.OPENAPI_INPUT || './openapi/novaix-v0.4.2.json',
  output: 'src/api',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk',
    '@hey-api/client-axios',
    '@tanstack/react-query',
  ],
})
