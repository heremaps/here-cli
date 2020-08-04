#!/bin/bash -e
#
# Copyright (C) 2019-2020 HERE Europe B.V.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0
# License-Filename: LICENSE
#
# simple script for npm publishing
# to be run from travis

set -ex

git rev-parse --abbrev-ref HEAD --

echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > ~/.npmrc

# Check that tag and package.json versions match
package_version=`node -p "require('./package.json').version"`
if [[ $package_version != $TRAVIS_TAG ]]; then
    echo "Tag version does not match package.json version."
    exit 1
fi

# Pack and test install
rm -f ./here-cli-*tgz
npm pack
installer_package=`ls here-cli-*tgz`
mv $installer_package /tmp/
pushd /tmp/
npm install $installer_package
popd

# Publish
npm publish

echo "Published Here CLI version $package_version to https://www.npmjs.com/ successfully!"
