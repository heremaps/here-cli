#!/usr/bin/env node

/*
  Copyright (C) 2018 - 2021 HERE Europe B.V.
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
import * as program from "commander";
import * as common from "./common";
import * as catalogUtil from "./catalogUtil";
import {ConfigApi} from "@here/olp-sdk-dataservice-api";

program.version("0.1.0");

program
    .command("create")
    .description("create a new catalog")
    .requiredOption("-i, --id <id>", "Id for catalog")
    .requiredOption("-n, --catalogName <catalogName>", "Name for catalog")
    .option("-s, --summary <summary>", "Short summary")
    .option("-m, --message <message>", "Description for catalog")
    .option("--token <token>", "a external token to create layer in other user's account")
    .action(async function (options) {
        if (!options.summary) {
            options.summary = "a new catalog created from commandline";
        }
        if (!options.message) {
            options.message = "a new catalog created from commandline";
        }
        catalogUtil.createCatalog(options)
        .catch(error => {
            common.handleError(error);
        });
    });

program
    .command("list")
    .alias("ls")
    .description("information about available catalogs")
    .option("-r, --raw", "show raw catalog definition")
    .option("--filter <filter>", "a comma separted strings to filter catalogs")
    .option("--token <token>", "a external token to access another user's catalogs")
    .action(async function (options) {
        try{
            let catalogs = await catalogUtil.getCatalogs(false,options.token);
            if (!catalogs || catalogs.length == 0) {
                console.log("No catalogs found");
            } else {
                if(options.filter){
                    const filterArray = options.filter.split(",");
                    catalogs = (catalogs as Array<ConfigApi.CatalogSummary>).filter((element: ConfigApi.CatalogSummary) => {
                        for (var i=0; i<filterArray.length; i++) {
                            if(element.title && element.title.toLowerCase().indexOf(filterArray[i].toLowerCase()) != -1 || (element.hrn && element.hrn.toLowerCase().indexOf(filterArray[i].toLowerCase()) != -1)){
                                return true;
                            }
                        }
                    });
                }
                if (options.raw) {
                    console.log(JSON.stringify(catalogs, null, 2));
                } else {
                    let fields = ["title","hrn", "href", "type"];
                    common.drawNewTable(catalogs, fields, [25, 40, 50, 22]);
                }
            }
        } catch(error) {
            common.handleError(error);
        }
    });

common.validate(
    [
        "list",
        "ls",
        "create"
    ],
    [process.argv[2]],
    program
);
program.name('here catalog').parse(process.argv);