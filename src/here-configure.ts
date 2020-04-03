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

import program = require('commander');
import common = require('./common');

const prompter = require('prompt');


program
    .version('0.1.0');

/*
program
    .command('set')
    .arguments('[env]')
    .description('configure HERE credentials for authentiction')
    .action(function(options) {
        setUserPass();
    });

function setAuth(env?: any) {
    prompter.start();
    prompter.get([{
        name: 'AppId',
        required: true
    }, {
        name: 'AppCode',
        hidden: true,
        conform: () => true
    }], function (err: any, result: any) {
        common.login(result['AppId'], result['AppCode']).catch(err => console.error(err));
    });
}
*/

program
    .command('account')
    .description('configure HERE account email/password for authentiction. Account can be created from https://developer.here.com/')
    .action(function (options) {
        setUserPass();
    });

async function setUserPass() {
    prompter.start();
    prompter.get([{
        name: 'Email',
        required: true
    }, {
        name: 'Password',
        hidden: true,
        conform: () => true
    }], async function (err: any, result: any) {
        await common.loginFlow(result['Email'], result['Password']);
    });
}

program
    .command('verify')
    //.arguments('[env]')
    .description('Verify credentials')
    .action(function (env, options) {
        common.verify();
    });


program
    .command('refresh')
    .description('Refresh account setup')
    .action(function (options:any) {
        common.refreshAccount(true);
    });

prompter.stop();
//program.parse(process.argv);

if (process.argv.length == 2) {
    setUserPass();
} else {
    common.validate(["help","verify","account","refresh"], [process.argv[2]], program);
    program.parse(process.argv);
}

process.on('uncaughtException', error => {
    console.log(error.message);
});