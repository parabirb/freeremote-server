# freeremote-server

The server for freeremote, an open source, radio-agnostic program for remote station control.

## Requirements

- Node.js 22+
- [flrig](http://www.w1hkj.com/) running with XML-RPC enabled
- A Discord bot application and an [ngrok](https://ngrok.com/) account

## Setup

1. `npm install`
2. Create `config.js` in the repository root. It must `export default` an object matching the `Config` type in [`config.d.ts`](./config.d.ts), which documents every field.
3. Run `npm run generate-keys` and paste the printed keys into `publicKey` and `privateKey` in `config.js`.
4. Run `npm run audio-devices` to find the IDs for `audioInput` and `audioOutput`.
5. `npm run build && npm start`

## Scripts

| Script                              | Description                                                           |
| ----------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                       | Run from source, restarting on changes                                |
| `npm run build`                     | Compile TypeScript to `dist/`                                         |
| `npm start`                         | Run the compiled server                                               |
| `npm run generate-keys`             | Generate the PGP key pair used for station keys                       |
| `npm run audio-devices`             | List available audio devices                                          |
| `npm run typecheck`                 | Type-check without emitting                                           |
| `npm run lint` / `npm run lint:fix` | Lint (and format, via Prettier) with [XO](https://github.com/xojs/xo) |
| `npm test`                          | Type-check and lint                                                   |
