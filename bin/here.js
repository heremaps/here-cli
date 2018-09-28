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

var program = require('commander');
var settings = require('user-settings').file('.herecli');
const latestVersion = require('latest-version');
var common = require('./common');

var commands = ["xyz","configure","transform","help","geocode"];
var inquirer = require('inquirer');
var fs = require('fs');
var path = require('path');

var questionLicense = [
  { 
    type: 'input',
    name: 'license',
    message: 'Enter (A)ccept or (D)ecline to proceed'
  }
];

function start(){
  program
  .version(getVersion())
  .command('configure [set|verify]', 'setup configuration for authentication').alias('c')
  .command('xyz [list|create|upload]', 'work with xyz spaces').alias('xs')
  .command('transform [csv2geo|shp2geo]', 'convert from csv/shapefile to geojson').alias('tf')
  .command('geocode', 'geocode feature').alias('gc')
  .parse(process.argv);
  common.validate(commands,program.args,program);
}

function getVersion(){
  var pkg = require('../package.json');
  return pkg.version;
}

sync(start);
function sync(callBack){
  if(settings.get('license') === 'true'){
    checkVersion(callBack);
  } else {
    showLicenseConfirmation(callBack);
  }
}

function checkVersion(callBack){
    const version = getVersion();
    const hrTime = process.hrtime();
    var ctime = hrTime[0] * 1000 + hrTime[1] / 1000000;
    var ltime = settings.get('lastAccessTime');
    var lastAccessVersion = getLastAccessVersion(ctime,ltime);
    if(lastAccessVersion && (version==lastAccessVersion)){
      //version matched with cached version
      callBack();
    }else{
      (async () => {
	  try{
          const pv = (await latestVersion('@here/cli'));
          if(pv == version){
            settings.set('lastAccessVersion',pv);
            settings.set('lastAccessTime',ctime);
            //version matched with current version. you are up to date
            callBack();
          }else{
            console.log("herecli('"+version+"') is out of date. Latest version is "+pv+". Use command 'npm install -g @here/cli' to update to the latest version");
	          process.exit(1);
          }
	  }catch(e){
	     callBack();
	  }
      })();
    }
}

function showLicenseConfirmation(callBack){
  console.log(fs.readFileSync(path.resolve(__dirname, 'beta-terms.txt'), 'utf8'));
  try{
    var opn = require("open");
    opn("http://explore.xyz.here.com/terms-and-conditions");
  }catch(e){

  }
  return inquirer.prompt(
    questionLicense
  ).then(answer => {
    //console.log(answer.license);
    var termsResp = answer.license?answer.license.toLowerCase():'decline';
    if(termsResp == "a" || termsResp == "accept"){
      //console.log("Thank you for accepting the license agreement");
      settings.set('license','true');
      checkVersion(callBack);
    } else {
      console.log("In order to use the HERE CLI, you will need to (A)ccept the license agreement. If you would like to remove the HERE CLI installed by npm, please enter (sudo) npm uninstall -g @here/cli");
      process.exit(1);
    }
  }).catch(error => console.error(error.stack))
}

function getLastAccessVersion(ctime,ltime){
  var time = (ctime-(ltime?ltime:0))/(1000*60);
  var lastAccessVersion = settings.get('lastAccessVersion');
  if(time>15){
    settings.set('lastAccessVersion',null);
    settings.set('lastAccessTime',null);
    return null;
  }else{
    return lastAccessVersion;
  }
}
