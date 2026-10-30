# bundle src/app.js -> assets/app.js (run from the project root: bash tools/build.sh)
NODE_PATH=$(pwd)/tools/node_modules node tools/node_modules/esbuild/bin/esbuild src/app.js --bundle --minify --format=iife --target=es2020 --define:global=globalThis "--define:process.env.NODE_ENV=\"production\"" --inject:src/shim.js --platform=browser --outfile=assets/app.js
