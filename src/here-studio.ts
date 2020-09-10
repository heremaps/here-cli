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

import * as common from './common';
import {handleError, execute} from "./common";
import * as program from 'commander';
import * as inquirer from "inquirer";
const commands = ["list", "open", "show", "delete"];

const studioBaseURL = "https://studio.here.com";
const projectsUrl = "/project-api/projects";

program
    .version('0.1.0');

program
    .command("list")
    .description("information about available xyz studio projects")
    .action(async function (options) {
        listProjects(options)
            .catch((error: any) => {
                handleError(error);
            })
    });

program
    .command("delete <project-id>")
    .description("delete the project with the given id")
    .option("--force", "skip the confirmation prompt")
    .action(async (projectId, options) => {
        deleteProject(projectId, options)
            .catch((error) => {
                handleError(error, false);
            })
    });

program
    .command("show <project-id>")
    .description("open the project with the given id")
    .action(async (projectId, options) => {
        showProject (projectId)
            .catch((error) => {
                handleError(error);
            })
    });

async function showProject (id : any) {
    const response = await getProject(id,{});
    if(response && response.body){
        const projectData = JSON.parse(response.body);
        if(projectData.status.toUpperCase() === "PUBLISHED"){
            const open = require("open");
            open(
                studioBaseURL+"/viewer/?project_id="+id
                , { wait: false });
        } else {
            console.log("FAILED: Project is not published."); 
            console.log("You can publish this project at: https://studio.here.com.");
        }
    } else {
        console.log("FAILED: Project does not exist or project is not published.");
    }
}

async function deleteProject  (id : any, options: any) {

    if (!options.force) {
        console.log("Are you sure you want to delete this project?")
        let answer: any = await inquirer.prompt([
            {
                type: 'input',
                name: 'confirmed',
                message: 'Enter (Y)es to continue or (N)o to cancel'
            }
        ]);
        if (answer.confirmed
            && answer.confirmed.toUpperCase() !== 'Y'
            && answer.confirmed.toUpperCase() !== 'YES') {
            process.exit(1);
        }
    }
    console.log("Deleting project : "+id)

    //If project exists send a DELETE request for that projectID
    const uri = projectsUrl+"/"+id;
    const cType = "";
    let response = await execute (uri, "DELETE", cType, "", options.token);

    if (response && response.statusCode === 204) {
        console.log("Successfully deleted project.")
    }
    else {
        console.log("Unable to delete project having project-id: "+id)
    }
}


/**
 * Will fetch all projects
 * @param options
 */
async function getAllProjects (options:any) {
    try {
        const uri = "/project-api/projects";
        const cType = "";
        let response = await execute(uri, "GET", cType, "", options.token);
        return response;
    } catch (error) {
        console.log("Unable to get all project data")
        return null;
    }
}

/**
 * Will get the project based on given id
 * @param id - Input project id
 * @param options
 */
async function getProject (id:string,options:any) {
    try {
        let uri = "/project-api/projects/"+id;
        let cType = "";
        let response = await execute(uri, "GET", cType, "", options.token, false, false);
        return response
    } catch (error) {
        console.log("Unable to get project data")
        return null;
    }
}


/**
 * Will list all the projects for the given user in below format
 *
 * @param options
 */
export async function listProjects (options: any) {
    console.log("Please wait; Fetching your list of projects...")

    let response = await getAllProjects(options)
    let body = JSON.parse(response.body);
    if (response.body.length == 0) {
        console.log("No xyz projects found");
    } else {
        let fields = ["id", "title", "status"];

        //Flattened array of project JsonObjects containing info about name, id and description, add any other info later as necessary
        let extractProjectInfo: any[] = new Array();

        //Iterate through all the projects and extract meta information in extractColumns Array having JSON Objects with keys of id, name and description,
        body.map((currentProject:any) => {

            //Check whether meta info like project description and name exists for that project? - > If exists Push the meta info with id in new
            if (currentProject.hasOwnProperty("meta")) {
                let viewerURL = "";
                if (currentProject.status.toUpperCase() === "PUBLISHED") {
                    viewerURL = "https://xyz.here.com/viewer/?project_id=" + currentProject.id;
                }
                let currentProjectDetails = {
                    id: currentProject.id,
                    title: currentProject.meta.name,
                    description: currentProject.meta.description,
                    status: currentProject.status,
                    viewerURL
                }
                extractProjectInfo.push(currentProjectDetails)
            }
        })

        //List the project
        common.drawNewTable(extractProjectInfo, fields, [40, 25, 12]);
    }
}

common.validate(commands, [process.argv[2]], program);
program.parse(process.argv);
if (!program.args.length) {
    common.verify();
}
