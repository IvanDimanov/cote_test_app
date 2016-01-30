/*
  This standalone script is meant to be executed as "node chat-server localhost:3000".
  It pairs with "chat-client" script to provide chat room access and
  host binding for all clients that want to join a room.
*/
'use strict';

const net = require('net');
const jsonStream = require('duplex-json-stream');

/* TODO: Proper error handling */
function trackError(error) {
  console.log(error);
}

/* Checks if the file was executed in the fashion of "node chat-server localhost:3000" */
const address = (process.argv[2] || '').split(':');
const ip = address[0];
const port = address[1];

if (!ip || !port) {
  trackError(`1st inline argument must be a Full Server Address (e.g. "127.0.0.1:8080", "localhost:123") but same is {${typeof process.argv[2]}} ${process.argv[2]}`);
  process.exit(1);
}

/*
  Keeps track of all rooms and their properties such as
  host, history messages, and number of connected clients.
*/
const rooms = new Map();


net.createServer(_socket => {
  /* Safely converts all incoming data into JSON objects */
  const socket = jsonStream(_socket);

  /*
    Do the necessary to remove the Host from position and
    check if there's a need to keep the room info in memory if there are no more connected clients.
  */
  function hostDisconnected(data) {
    return () => {
      console.log(`Host "${data.clientName}" of room "${data.roomName}" just disconnected`);

      const room = rooms.get(data.roomName);
      delete room.hostName;
      room.clients.splice(room.clients.indexOf(data.clientName), 1);

      /* Clear all room records if the host was the only one in the room */
      if (room.clients.length) {
        rooms.set(data.roomName, room);
      } else {
        console.log(`Deleting room "${data.roomName}" duo to lack of clients`);
        rooms.delete(data.roomName);
      }
    };
  }

  /*
    When a client wants to join a chat room using his 'socket',
    we'll send him the room host so he can gain access through him or
    if he's the 1st to join the room - we'll make him the host.
  */
  function joinRoomRequest(data) {
    if (!data.roomName ||
        typeof data.roomName !== 'string'
    ) {
      trackError(`Request JSON object must have a {string} "roomName" property but same is {${typeof data.roomName}} ${data.roomName}`);
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    if (!data.clientName ||
        typeof data.clientName !== 'string'
    ) {
      trackError(`Request JSON object must have a {string} "clientName" property but same is {${typeof data.clientName}} ${data.clientName}`);
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    /* If this client is the 1st to connect to a Chat Room, he instantly become its host */
    if (!rooms.has(data.roomName)) {
      rooms.set(data.roomName, {
        name: data.roomName,
        hostName: data.clientName,
        clients: [],
      });
    } else if (~rooms.get(data.roomName).clients.indexOf(data.clientName)) {
      trackError(`Client name "${data.clientName}" duplicates in room "${data.roomName}"`);
      socket.end({
        error: `Client name "${data.clientName}" is already taken`,
      });
      socket.destroy();
      return;
    }

    /* Maintain the list of connected clients */
    const room = rooms.get(data.roomName);
    room.clients.push(data.clientName);
    rooms.set(data.roomName, room);

    socket.write({
      hostName: room.hostName,
    });

    /* Keep the persistent connection only for the Room Host */
    if (room.hostName !== data.clientName) {
      socket.destroy();
    } else {
      socket.once('end', hostDisconnected(data));
    }
  }


  function reduceRoomClients(data) {
    if (!data.roomName ||
        typeof data.roomName !== 'string'
    ) {
      trackError(`Request JSON object must have a {string} "roomName" property but same is {${typeof data.roomName}} ${data.roomName}`);
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    if (!data.leftClientName ||
        typeof data.leftClientName !== 'string'
    ) {
      trackError(`Request JSON object must have a {string} "leftClientName" property but same is {${typeof data.leftClientName}} ${data.leftClientName}`);
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    if (!rooms.has(data.roomName)) {
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    const room = rooms.get(data.roomName);
    room.clients.splice(room.clients.indexOf(data.leftClientName), 1);
    rooms.set(data.roomName, room);
  }

  /*
    Called from a 'socket' after a room host has been disconnected and
    the oldest room client tries to become the new host.
  */
  function reclaimRoomHost(data) {
    if (!data.roomName ||
        typeof data.roomName !== 'string'
    ) {
      trackError(`Request JSON object must have a {string} "roomName" property but same is {${typeof data.roomName}} ${data.roomName}`);
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    if (!data.clientName ||
        typeof data.clientName !== 'string'
    ) {
      trackError(`Request JSON object must have a {string} "clientName" property but same is {${typeof data.clientName}} ${data.clientName}`);
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    if (!rooms.has(data.roomName)) {
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }


    const room = rooms.get(data.roomName);
    if (!~room.clients.indexOf(data.clientName)) {
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    /*
      Assign the client as a Chat host and
      keep his persistent connection for new requests
    */
    room.hostName = data.clientName;
    rooms.set(data.roomName, room);

    socket.write({
      hostName: room.hostName,
    });

    console.log(`"${data.clientName}" is the new host of room "${data.roomName}"`);

    /* Be sure to follow the same procedure even when the new host get disconnected */
    socket.once('end', hostDisconnected(data));
  }


  /*
    Main request router.
    Keep in mind that all validation errors sent back to the callee
    have the same content of 'Invalid request', just in case of communication attack.
  */
  socket.on('data', data => {
    if (!data ||
        typeof data !== 'object'
    ) {
      socket.end({
        error: 'Invalid request',
      });
      socket.destroy();
      return;
    }

    switch (data.type) {
      case 'joinRoom':
        joinRoomRequest(data);
        break;

      case 'clientLeft':
        reduceRoomClients(data);
        break;

      case 'reclaimRoomHost':
        reclaimRoomHost(data);
        break;

      default:
        socket.end({
          error: 'Invalid request',
        });
        socket.destroy();
    }
  });
})
.listen(port, ip, () => console.log(`Server started at ${ip}:${port}`));
