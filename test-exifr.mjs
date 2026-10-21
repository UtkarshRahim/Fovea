import exifr from 'exifr';
import { readFile } from 'fs/promises';

const file = await readFile('/Users/utkarsh/Desktop/BTR Assignment/3-A.NEF');

const tags = await exifr.parse(file, {
  tiff: true,
  exif: true,
  gps: true,
  ifd1: true,
  interop: true,
  makerNote: true,
  translateValues: false,
  reviveValues: false,
  mergeOutput: true,
  pick: undefined,
});

console.log('MeteringMode:', tags.MeteringMode);
console.log('All metering-related keys:', Object.keys(tags).filter(k => k.toLowerCase().includes('meter')));
console.log('\nSample of all keys:', Object.keys(tags).slice(0, 50));
