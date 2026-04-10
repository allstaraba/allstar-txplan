#!/bin/bash
cd ~/allstar-txplan
npm install 2>/dev/null
cd client && npm install 2>/dev/null && cd ..
# Run backend and frontend dev servers concurrently
npx concurrently "node server.js" "cd client && npm run dev"
