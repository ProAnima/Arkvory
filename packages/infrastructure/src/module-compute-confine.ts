import { fileURLToPath } from 'node:url';
import { confineResolution, allowResolutionUnder } from '@proanima/arkvory-resolution';

confineResolution();
// <release>/packages/infrastructure/dist/: a fixed helper in the same verified release.
allowResolutionUnder(fileURLToPath(new URL('../../../', import.meta.url)));
