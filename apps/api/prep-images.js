"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./src/app.module");
const image_hash_service_1 = require("./src/modules/catalog/image-hash.service");
const MAP = [
    ['pants.png', '11_jeans_mom_light_blue.jpg'],
    ['t-shirt.png', '12_tshirt_basic_black.jpg'],
    ['shorts.png', '13_shorts_denim_light_blue.jpg'],
    ['shirt.jpg', '14_shirt_linen_grey.jpg'],
];
(async () => {
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, { logger: ['error'] });
    const hasher = app.get(image_hash_service_1.ImageHashService);
    const srcDir = path.resolve('../../new-images');
    const outDir = path.resolve('/tmp/prod-images');
    fs.mkdirSync(outDir, { recursive: true });
    for (const [src, target] of MAP) {
        const raw = fs.readFileSync(path.join(srcDir, src));
        const buf = await sharp(raw)
            .resize({ width: 1200, height: 1600, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85, mozjpeg: true })
            .toBuffer();
        fs.writeFileSync(path.join(outDir, target), buf);
        const phash = await hasher.hashFromBuffer(buf);
        const meta = await sharp(buf).metadata();
        console.log(`${target.padEnd(32)} ${String(Math.round(raw.length / 1024)).padStart(5)}KB → ${String(Math.round(buf.length / 1024)).padStart(4)}KB  ${meta.width}x${meta.height}  phash=${phash}`);
    }
    await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=prep-images.js.map