/*
  This standalone script is meant to be executed as "node chat-client localhost:3000 Steve tech-stuff".
  It will communicate with its pair "chat-server" script in order to present a chat room to the callee
  where he can exchange messages and switch between roles of regular Client and Host.
*/
'use strict';

const net = require('net');
const jsonStream = require('duplex-json-stream');
const cote = require('cote');

const Subscriber = cote.Subscriber;
const Publisher = cote.Publisher;

const Responder = cote.Responder;
const Requester = cote.Requester;

/* TODO: Proper error handling */
function trackError(error) {
  console.log(error);
}

const address = (process.argv[2] || '').split(':');
const ip = address[0];
const port = address[1];

if (!ip || !port) {
  trackError(`1st inline argument must be a Full Server Address (e.g. "127.0.0.1:8080", "localhost:123") but same is {${typeof process.argv[2]}} ${process.argv[2]}`);
  process.exit(1);
}

if (typeof process.argv[3] !== 'string') {
  trackError(`2nd inline argument must be a Client Name (e.g. "John", "test-984") but same is {${typeof process.argv[3]}} ${process.argv[3]}`);
  process.exit(1);
}
const clientName = process.argv[3];

if (typeof process.argv[4] !== 'string') {
  trackError(`3rd inline argument must be a Room Name (e.g. "my-room", "newcomers") but same is {${typeof process.argv[4]}} ${process.argv[4]}`);
  process.exit(1);
}
const roomName = process.argv[4];

/*
  Each client keeps a copy of the entire room state
  so he can easily switch between roles of regular Client and Host.
*/
let chatManagement = {
  name: roomName,
  clients: [clientName],
  pastMessages: [],
};

/* Used to communicate with the central server and with all other clients */
let serverConnection;
let messenger;

/* Common "UI" message presentation */
function printMessage(message) {
  if (!message ||
      typeof message !== 'object'
  ) {
    console.log(`<Unexpected message>: ${message}`);
    return;
  }

  switch (message.type) {
    case 'clientInput':
      console.log(`${message.clientName}> ${message.text}`);
      break;

    case 'system':
      console.log(`system> ${message.text}`);
      break;

    default:
      console.log(`<Unexpected message type>: ${JSON.stringify(message)}`);
  }
}


/* As the "chosen one" host, we are the only client that can gain or deny access to other clients */
function becomeRoomHost() {
  new Responder({
    name: `chat-room-${roomName}`,
    respondsTo: ['accessRoom'],
  }, {
    log: false,
  })
  .on('accessRoom', (request, callback) => {
    /* TODO: We can have auth here should we choose to go on with limited access rooms */
    if (typeof request.clientName !== 'string') {
      callback({
        error: 'Invalid "clientName" property',
      });
      return;
    }

    chatManagement.clients.push(request.clientName);
    callback({
      chatManagement,
    });
  });
}


/*
  Every time the chat host got disconnected
  we can try to became the next room host
  if we're the oldest in-line the room history.
  NOTE: If the original room host reconnects - he'll be the newest in the room.
*/
function reclaimRoomHost() {
  serverConnection = net.connect(port, ip, () => {
    serverConnection.write({
      type: 'reclaimRoomHost',
      clientName,
      roomName,
    });
  });

  serverConnection = jsonStream(serverConnection);

  serverConnection.on('data', data => {
    /* Something went wrong with the client host claim */
    if (!data ||
        typeof data !== 'object' ||
        data.error
    ) {
      /* Do not exit coz still there could be other client that can make the claim */
      trackError(data);
      return;
    }

    chatManagement.hostName = data.hostName;

    /*
      Check if the server chose us as the next host or
      there were any other eligible clients.
    */
    if (data.hostName === clientName) {
      becomeRoomHost();
      messenger.publish('system', {
        type: 'newHost',
        hostName: data.hostName,
      });
    } else {
      printMessage({
        type: 'system',
        text: `Your claim to become the room host had been denied: ${JSON.stringify(data)}`,
      });
    }
  });
}


/*
  Bind to all message and system related events that happen in the chat
  like new clients come and goes or incoming messages from other users.
*/
function listenForNewMessages() {
  const subscriptionChatRoomName = `chat-room-${roomName}`;
  new Subscriber({
    name: subscriptionChatRoomName,
    subscribesTo: ['messages', 'system'],
  }, {
    log: false,
  })

  /*
    Get notified when we as a Client are ready
    for printing the entire chat history and start chatting ourselves or
    there's a new chat Client that just joined.
  */
  .on('added', clientInstance => {
    if (clientInstance.advertisement.name === subscriptionChatRoomName) {
      /* Notify the client of its "ready state" */
      if (clientInstance.advertisement.clientName === clientName) {
        const text = chatManagement.hostName === clientName ? 'You are the host of the room.' : `You are connected. ${chatManagement.hostName} is the host of the room.`;
        printMessage({
          type: 'system',
          text,
        });

        /* Present the client all the messages he missed */
        chatManagement.pastMessages.forEach(printMessage);

      /* Maintain internal clients list using the new subscriber */
      } else if (typeof clientInstance.advertisement.clientName === 'string' &&
        !~chatManagement.clients.indexOf(clientInstance.advertisement.clientName)
      ) {
        chatManagement.clients.push(clientInstance.advertisement.clientName);
      }
    }
  })

  .on('messages', message => {
    chatManagement.pastMessages.push(message);
    printMessage(message);
  })

  .on('system', data => {
    if (data.type === 'newHost') {
      chatManagement.hostName = data.hostName;
      printMessage({
        type: 'system',
        text: `${data.hostName} is the new host.`,
      });
    }
  })

  /*
    Get notified every time a chat client does off-line and
    if it's the Host - check if we can sit in his place.
  */
  .on('removed', clientInstance => {
    if (clientInstance.advertisement.name === subscriptionChatRoomName) {
      /* Maintain internal record of currently connected clients */
      chatManagement.clients.splice(
        chatManagement.clients.indexOf(clientInstance.advertisement.clientName),
        1
      );

      printMessage({
        type: 'system',
        text: `${clientInstance.advertisement.clientName} left.`,
      });

      /* Since we are the host we need to keep updated the central server */
      if (chatManagement.hostName === clientName) {
        serverConnection.write({
          type: 'clientLeft',
          roomName,
          leftClientName: clientInstance.advertisement.clientName,
        });
      }

      /*
        if it was the host who left the chat,
        check if the current client is the oldest in the room
        hence he need to claim new host position.
      */
      if (chatManagement.hostName === clientInstance.advertisement.clientName &&
          chatManagement.clients[0] === clientName
      ) {
        reclaimRoomHost();
      }
    }
  });
}


/* Bind to the Room channel so we can send messages directly to all other members */
function establishMessageSending() {
  messenger = new Publisher({
    name: `chat-room-${roomName}`,
    broadcasts: ['messages', 'system'],
    clientName,
  }, {
    log: false,
  });

  messenger.on('ready', () => {
    process.stdin.on('data', data => {
      messenger.publish('messages', {
        type: 'clientInput',
        clientName,
        text: data.toString().trim(),
      });
    });
  });
}


/* Claim an access to chat history and permission to read-write messages */
function requestHostPermission() {
  const accessRequest = new Requester({
    name: `chat-room-${roomName}`,
    requests: ['accessRoom'],
  }, {
    log: false,
  })
  .once('ready', () => {
    accessRequest.send({
      type: 'accessRoom',
      clientName,
    }, response => {
      if (!response ||
          typeof response !== 'object' ||
          response.error
      ) {
        trackError(`Unable to access chat room: ${response}`);
        return;
      }

      chatManagement = response.chatManagement;

      listenForNewMessages();
      establishMessageSending();
    });
  });
}


/* Kickoff the process by requesting chat room connection from the central server */
(function connectToServer() {
  serverConnection = net.connect(port, ip, () => {
    serverConnection.write({
      type: 'joinRoom',
      clientName,
      roomName,
    });
  });

  /* Converts all data exchange into JSON form */
  serverConnection = jsonStream(serverConnection);

  serverConnection.on('data', data => {
    /* Something went wrong with the client subscription */
    if (!data ||
        typeof data !== 'object' ||
        data.error
    ) {
      trackError(data);
      process.exit(1);
    }

    chatManagement.hostName = data.hostName;

    /* Check what role does the server arranged for us: regular Client or Host */
    if (data.hostName === clientName) {
      becomeRoomHost();
      listenForNewMessages();
      establishMessageSending();
    } else {
      requestHostPermission();
    }
  });
}());
