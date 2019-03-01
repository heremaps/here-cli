#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const program = require("commander");
const common = require("./common");
const transform = require("./transformutil");
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
    .action(function (path, opt) {
    return __awaiter(this, void 0, void 0, function* () {
        transform.read(path, true).then(result => {
            console.log(JSON.stringify({ features: transform.transform(result, opt.lat, opt.lon, opt.alt), type: "FeatureCollection" }, null, 3)); //Converted json object from csv data
        });
    });
});
program
    .command('shp2geo <path>')
    .description('convert shapefile to geojson')
    .action(function (path, opt) {
    transform.readShapeFile(path).then(fc => {
        console.log(JSON.stringify(fc));
    });
});
common.validate(commands, [process.argv[2]], program);
prompter.stop();
program.parse(process.argv);
if (!program.args.length) {
    common.verify();
}
