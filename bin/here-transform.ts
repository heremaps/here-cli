#!/usr/bin/env node

/*
  Copyright (C) 2018 HERE Europe B.V.
  SPDX-License-Identifier: MIT

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  'Software'), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import * as program from 'commander';
import * as common from './common';
import * as transform from './transformutil';

const prompter = require('prompt');

const commands = ["csv2geo", "shp2geo"];

program
    .version('0.1.0');

program
    .command('csv2geo <path>')
    .description('convert csv to geojson')
    .option('-y, --lat [lat]', 'latitude field name')
    .option('-x, --lon [lon]', 'longitude field name')
    .option('-z, --alt [alt]', 'altitude field name')
    .action(async function (path, opt) {
        transform.read(path, true).then(result => {
            console.log(JSON.stringify({ features: transform.transform(result, opt.lat, opt.lon, opt.alt), type: "FeatureCollection" }, null, 3)); //Converted json object from csv data
        });
    });

program
    .command('shp2geo <path>')
    .description('convert shapefile to geojson')
    .action(function (path, opt) {
        transform.readShapeFile(path).then(fc =>  {
            console.log(JSON.stringify(fc));
        });
    });

common.validate(commands, [process.argv[2]], program);
prompter.stop();
program.parse(process.argv);
if (!program.args.length) {
    common.verify();
}
