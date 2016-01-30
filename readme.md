# P2P Test chat app build with [cote.js](https://github.com/dashersw/cote)

This is a 2 parts app: *Client* and *Server*.
It aims to create a *P2P chat* where all clients communicate with each other directly
but still have a *Central Server* for some features like switching roles between *regular Client* and *Host*.


## Install
```shell
git clone https://github.com/IvanDimanov/cote_test_app.git
cd cote_test_app
npm install
```

## Usage
1st start the *Central Server* with
```shell
node chat-server.js localhost:3000
```

then open a new terminal and use the *Client part* to connect to a room of your choice
```shell
node chat-client.js localhost:3000 Steve tech-talk
```

## Roles flow
*1st Client* who connects to a room (e.g. "tech-talk") will become its *Host* - the person who manages permissions.
If *the Host* got disconnected, the *next Client oldest in-line* will become the *new Host*.