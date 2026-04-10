#!/bin/bash
cd ~/allstar-txplan
if [ ! -d node_modules ]; then npm install; fi
if [ ! -d client/node_modules ]; then cd client && npm install && cd ..; fi
cd client && npm run build && cd ..
node server.js
