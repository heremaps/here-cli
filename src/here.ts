#!/usr/bin/env node

/*
  Copyright (C) 2018 - 2019 HERE Europe B.V.
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

import * as common from "./common";
import * as inquirer from 'inquirer';

const program = require('commander');
const settings = require('user-settings').file('.herecli');
const latestVersion = require('latest-version');

const commands = ["xyz", "studio","configure", "transform", "help", "geocode"];
const fs = require('fs');
const path = require('path');

const questionLicense = [
    {
        type: 'input',
        name: 'license',
        message: 'Enter (A)ccept or (D)ecline to proceed'
    }
];

async function start() {
    if (settings.get('GAlicense') === 'true') {
        await checkVersion();
    } else {
        await showLicenseConfirmation();
    }

    program
    .version(getVersion())
        .command('configure [set|verify]', 'setup configuration for authentication').alias('c')
        .command('xyz [list|create|upload]', 'work with xyz spaces').alias('xs')
        .command('studio [list|delete|show]', 'work with xyz studio projects').alias('s')
        .command('transform [csv2geo|shp2geo|gpx2geo]', 'convert from csv/shapefile/gpx to geojson').alias('tf')
        .command('geocode', 'geocode feature').alias('gc')
        .parse(process.argv);
    common.validate(commands, program.args, program);
}

start().catch(err => console.log(err));

function getVersion() {
    const pkg = require('../package.json');
    return pkg.version;
}

async function checkVersion() {
    const version = getVersion();
    const hrTime = process.hrtime();
    const ctime = hrTime[0] * 1000 + hrTime[1] / 1000000;
    const ltime = settings.get('lastAccessTime');
    const lastAccessVersion = getLastAccessVersion(ctime, ltime);
    if (lastAccessVersion && (version == lastAccessVersion)) {
        //version matched with cached version
        return;
    }

    const pv = await latestVersion('@here/cli');
    if (pv > version) {
        console.log("herecli('" + version + "') is out of date. Latest version is " + pv + ". Use command 'npm install -g @here/cli' to update to the latest version");
        process.exit(1);
    }
    // version matched with current version. We are up to date
    settings.set('lastAccessVersion', pv);
    settings.set('lastAccessTime', ctime);
}

async function showLicenseConfirmation() {
    console.log(fs.readFileSync(path.resolve(__dirname, 'beta-terms.txt'), 'utf8'));
    try {
        const opn = require("opn");
        opn("http://explore.xyz.here.com/terms-and-conditions",{wait:false});
    } catch {
    }

    const answer = await inquirer.prompt<{ license?: string }>(questionLicense);

    const termsResp = answer.license ? answer.license.toLowerCase() : 'decline';
    if (termsResp === "a" || termsResp === "accept") {
        settings.set('GAlicense', 'true');
        await checkVersion();
    } else {
        console.log("In order to use the HERE CLI, you will need to (A)ccept the license agreement. If you would like to remove the HERE CLI installed by npm, please enter npm uninstall -g @here/cli");
        process.exit(1);
    }
}

function getLastAccessVersion(ctime: number, ltime: number | undefined) {
    const time = (ctime - (ltime ? ltime : 0)) / (1000 * 60);
    const lastAccessVersion = settings.get('lastAccessVersion');
    if (time > 15) {
        settings.set('lastAccessVersion', null);
        settings.set('lastAccessTime', null);
        return null;
    }
    return lastAccessVersion;
}
