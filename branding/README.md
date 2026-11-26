# Arkvory identity

Copyright © Ian Panaev. Brand owner: Ian Panaev personally. Studio: ProAnimaStudio. The marks are not licensed for other uses (LICENSE.md, section 6): they ship with the unmodified software and may be used only to name the source; they are not an open icon pack.

`identity.json` defines the geometric A mark, its negative-space opening and palette. `npm run brand:generate` creates SVG assets on all platforms and ICO/PNG on Windows using the system drawing runtime. Commit the generated assets together with the source. ICO files contain 16, 24, 32, 48, 64, 128 and 256 px frames.

- `arkvory`: product, browser favicon, server installer and desktop shortcut.
- `arkvory-cli`: terminal client and its installer.
- `arkvory-remote`: remote setup launcher.
- `arkvory-monochrome`: monochrome documentation/print use.
- `media/arkvory-tour-poster.jpg`: the poster of the English product tour (3:45, 1080p, H.264/AAC, music generated for it). The video itself is `wiki/public/media/arkvory-tour.mp4`, served by the documentation site at `/media/arkvory-tour.mp4` so browsers play it directly (GitHub does not play repository files of this size); the README poster links there. The source scenes are kept outside the repository; re-encode the published file instead of committing larger masters.

Do not stretch, crop or rotate the mark. The cyan/blue tile works on both interface themes. Keep the full wordmark as live text for legibility and localization. Windows installer artwork uses this same source geometry and palette.

Основной знак — геометрическая A с открытым внутренним пространством. SVG масштабируется без потери качества; ICO содержит отдельные размеры для Windows. Правообладатель и держатель бренда — Ian Panaev лично. Изменения исходника и сгенерированных файлов фиксируются вместе. Монохромный знак предназначен для одноцветного вывода; иконки CLI и remote setup различаются дополнительным знаком назначения. Обложка видеообзора на английском — `media/arkvory-tour-poster.jpg`; само видео лежит в `wiki/public/media/arkvory-tour.mp4` и открывается с сайта документации по ссылке из README; исходные сцены хранятся вне репозитория.
