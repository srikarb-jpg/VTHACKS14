/**
 * Fonts are bundled, never fetched.
 *
 * Loading them from Google Fonts would make every open of the popup a request
 * to a third party, which is exactly the thing this product says it does not
 * do. These packages ship the font files into the extension itself.
 */
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource/caveat/600.css';
