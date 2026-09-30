# CRT Glitch Studio

Студия CRT/глитч-эффекта на WebGL. Загружаете картинку или видео, подбираете эффект и выгружаете PNG, ролик перехода или пресет. Тот же эффект можно поставить на любой сайт одним тегом `<crt-glitch>`.

Эффект вдохновлён сайтом [ausify.com.au](https://ausify.com.au). Шейдер написан заново: дрожание строк, хроматическая аберрация, RGB-маска кинескопа, строки развёртки и «рывок» кадра при появлении.

## Что внутри

```
index.html                     студия (открывается в браузере)
src/
  crt-glitch.js                сам эффект: веб-компонент <crt-glitch>, без зависимостей
  studio.js                    логика студии: пульт, пресеты, экспорт, генерация кода
  studio.css                   стили студии
integrations/
  astro/CrtGlitch.astro        обёртка для Astro
examples/
  basic.html                   минимальный пример использования компонента
.nojekyll                      говорит GitHub Pages отдавать файлы как есть
```

## Запуск на компьютере

Браузер не запускает JS-модули из файла, открытого двойным кликом, поэтому нужен маленький локальный сервер. В папке проекта выполните:

```bash
python3 -m http.server 8000
```

и откройте http://localhost:8000. Подойдёт и `npx serve`.

## Эффект на своём сайте

Подключите `src/crt-glitch.js` и оберните картинку или видео:

```html
<script type="module" src="/js/crt-glitch.js"></script>

<crt-glitch trigger="visible" preset='{"ca":0.0015,"tear":0.05}'>
  <img src="/images/hero.jpg" alt="Описание">
</crt-glitch>
```

### Параметры

| Атрибут    | По умолчанию | Что делает |
|------------|--------------|------------|
| `preset`   | —            | JSON со всеми параметрами сразу (копируется из студии) |
| `jitter`   | `0.00065`    | постоянное дрожание строк |
| `ca`       | `0.0015`     | хроматическая аберрация |
| `tear`     | `0.05`       | сила рывка строк во время перехода |
| `mask`     | `false`      | RGB-маска и строки развёртки |
| `pixel`    | `1`          | размер ячейки маски |
| `duration` | `1100`       | длительность перехода, мс |
| `fade`     | `true`       | появление из чёрного |
| `trigger`  | `visible`    | `visible`, `load`, `hover` или `none` |
| `idle`     | `0`          | частота случайных микро-глитчей, от 0 до 1 |
| `fit`      | `cover`      | `cover` или `contain` |

Методы: `el.play()` проигрывает переход, `el.set({...})` меняет параметры, `el.snapshot()` возвращает PNG текущего кадра.

Картинки и видео должны лежать на том же домене, что и сайт, или отдаваться с CORS-заголовком. Иначе браузер не пустит их в WebGL. Если WebGL недоступен, остаётся обычная картинка. При включённой настройке «уменьшить движение» эффект показывается без анимации.

### Astro

Скопируйте `src/crt-glitch.js` и `integrations/astro/CrtGlitch.astro` в одну папку проекта, например `src/components/crt-glitch/`:

```astro
---
import CrtGlitch from '../components/crt-glitch/CrtGlitch.astro';
import hero from '../assets/hero.jpg';
---
<CrtGlitch src={hero} alt="Обложка" trigger="visible" preset={{ ca: 0.0015, tear: 0.05 }} />
```

## Публикация на GitHub Pages

Settings → Pages → Source: **Deploy from a branch**, ветка `main`, папка `/ (root)`. Через минуту студия появится по адресу `https://<логин>.github.io/crt-glitch-studio/`.

## Лицензия

MIT
