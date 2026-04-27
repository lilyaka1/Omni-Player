#!/bin/bash
cd "$(dirname "$0")/frontend"
npm install 2>/dev/null
npm run dev
