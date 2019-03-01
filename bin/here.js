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
const common = require("./common");
const inquirer = require("inquirer");
const program = require('commander');
const settings = require('user-settings').file('.herecli');
const latestVersion = require('latest-version');
const commands = ["xyz", "configure", "transform", "help", "geocode"];
const fs = require('fs');
const path = require('path');
const questionLicense = [
    {
        type: 'input',
        name: 'license',
        message: 'Enter (A)ccept or (D)ecline to proceed'
    }
];
function start() {
    return __awaiter(this, void 0, void 0, function* () {
        if (settings.get('license') === 'true') {
            yield checkVersion();
        }
        else {
            yield showLicenseConfirmation();
        }
        program
            .version(getVersion())
            .command('configure [set|verify]', 'setup configuration for authentication').alias('c')
            .command('xyz [list|create|upload]', 'work with xyz spaces').alias('xs')
            .command('transform [csv2geo|shp2geo]', 'convert from csv/shapefile to geojson').alias('tf')
            .command('geocode', 'geocode feature').alias('gc')
            .parse(process.argv);
        common.validate(commands, program.args, program);
    });
}
start().catch(err => console.log(err));
function getVersion() {
    const pkg = require('../package.json');
    return pkg.version;
}
function checkVersion() {
    return __awaiter(this, void 0, void 0, function* () {
        const version = getVersion();
        const hrTime = process.hrtime();
        const ctime = hrTime[0] * 1000 + hrTime[1] / 1000000;
        const ltime = settings.get('lastAccessTime');
        const lastAccessVersion = getLastAccessVersion(ctime, ltime);
        if (lastAccessVersion && (version == lastAccessVersion)) {
            //version matched with cached version
            return;
        }
        const pv = yield latestVersion('@here/cli');
        if (pv !== version) {
            console.log("herecli('" + version + "') is out of date. Latest version is " + pv + ". Use command 'npm install -g @here/cli' to update to the latest version");
            process.exit(1);
        }
        // version matched with current version. We are up to date
        settings.set('lastAccessVersion', pv);
        settings.set('lastAccessTime', ctime);
    });
}
function showLicenseConfirmation() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(fs.readFileSync(path.resolve(__dirname, 'beta-terms.txt'), 'utf8'));
        try {
            const opn = require("opn");
            opn("http://explore.xyz.here.com/terms-and-conditions", { wait: false });
        }
        catch (_a) {
        }
        const answer = yield inquirer.prompt(questionLicense);
        const termsResp = answer.license ? answer.license.toLowerCase() : 'decline';
        if (termsResp === "a" || termsResp === "accept") {
            settings.set('license', 'true');
            yield checkVersion();
        }
        else {
            console.log("In order to use the HERE CLI, you will need to (A)ccept the license agreement. If you would like to remove the HERE CLI installed by npm, please enter npm uninstall -g @here/cli");
            process.exit(1);
        }
    });
}
function getLastAccessVersion(ctime, ltime) {
    const time = (ctime - (ltime ? ltime : 0)) / (1000 * 60);
    const lastAccessVersion = settings.get('lastAccessVersion');
    if (time > 15) {
        settings.set('lastAccessVersion', null);
        settings.set('lastAccessTime', null);
        return null;
    }
    return lastAccessVersion;
}
