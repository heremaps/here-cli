# HERE CLI
[![Build Status](https://travis-ci.com/heremaps/here-cli.svg?branch=master)](https://travis-ci.com/heremaps/here-cli)

HERE CLI is a Node.js command-line interface to work with HERE APIs starting with [HERE XYZ Hub](https://www.here.xyz) APIs. Right now, it allows you to interact with HERE XYZ Hub to create and manage your Spaces, and easily upload and manage your datasets.

### Prerequisites

HERE CLI is built on Node.js, a cross-platform efficient language to write even complex, local applications.

To use the  HERE CLI, you should have npm installed. The best way is to go to nodejs.org and install the appropriate package for your system (both 8.x LTS and 10.x Current should work). If you need
help with this have a look at our [CLI Introduction Guide](https://www.here.xyz/cli/).

### Installing the CLI

To install the HERE CLI use the following command. Depending on your system, you might need elevated permissions (like sudo) to install globally.

```
npm install -g @here/cli
```

If all goes well, you can check if the CLI is installed correctly by just runnning

```
here --help
```


## Configure HERE CLI

As the HERE CLI works with HERE APIs in the cloud, you need to configure your developer identity.
This only needs to be done once. Just run `here configure` to set the `email` and `password`.
For detailed information on getting a Developer account have a look at our [Getting Started Guide](https://www.here.xyz/getting-started/).

## Supported Commands

The CLI currently support the following sub-commands:

```
- configure|c [set|verify|account]  setup configuration for authentication
- xyz|xs [list|create|upload]       work with xyz spaces
- studio [list|delete|clone|show]   work with xyz studio projects
- transform|tf [csv2geo|shp2geo]    convert from csv/shapefile to geojson
- help [cmd]                        display help for [cmd]
```

## Development

### Building the CLI

To develop the CLI further and add new features, first clone this repository and install the 
npm dependencies.

```
git clone https://github.com/heremaps/here-cli.git
npm install
```

Normally as a user you would install the CLI with a `-g` switch globally so that it can be
used outside of a package directory. To make development easier it makes more sense not to
that globally as that requires elevated permissions.

You should test and debug the commands by running the respective .js file. We use 
[npm commander](https://www.npmjs.com/package/commander) to drive the command parsing and
execution. To get a good 
understanding how it *feels* on the commandline use local linking to make the `bin` sources
available as executable commands:

```
npm link
```

Finally to package and distribute a new release (which we would do, not you) we update and
tag the version followed by

```
npm pack ...
npm deploy ...
```

### Contributing

We encourage contributions. For fixes and improvements it's helpful to have an [issue](http://github.com/heremaps/here-cli/issues) to reference to. So please file them for us to provide focus. Also read the notes in [CONTRIBUTING.md](CONTRIBUTING.md).

When you add a new sub-command (as `bin/here-commandname.js`) please make sure to also include the relevant documentation (as `docs/commandname.md`).

If the command is interacting with a HERE service, please include a links to the relevant service documenation at [developer.here.com](https://developer.here.com/documentation). 

## License

Copyright (C) 2018 - 2019 HERE Europe B.V.

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details


