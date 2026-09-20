import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: process.env.API_SCHEMA_INPUT || './api-schema/novaix-v0.4.4.json',
  output: 'src/api',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk',
    '@hey-api/client-axios',
    '@tanstack/react-query',
  ],
})
