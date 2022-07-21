const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();

app.use(express.json());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(-1);
  }
};
initializeDBAndServer();

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.body.username = payload.username;

        next();
      }
    });
  }
}

//api-II

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API-I

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;

  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const getUserDetails = `
    SELECT * FROM user WHERE username='${username}';`;
  const userDetails = await db.get(getUserDetails);
  console.log(userDetails);
  if (userDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    const passwordLength = password.length;
    if (passwordLength < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const postQuery = `
            INSERT INTO
                user (username,password,name,gender)
            VALUES ('${username}','${hashedPassword}','${name}','${gender}');`;
      await db.run(postQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const requestUsername = request.body["username"];
  const getUserID = `
  SELECT user_id
  FROM user
  WHERE username='${requestUsername}';`;
  const userIdResult = await db.get(getUserID);

  const followingTweetsQuery = `
    SELECT user.username as username,
           tweet.tweet as tweet,
           tweet.date_time as dateTime 
    FROM (follower
    INNER JOIN tweet ON follower.following_user_id=tweet.user_id) as T
    INNER JOIN user ON T.following_user_id=user.user_id
    WHERE follower.follower_user_id=${userIdResult.user_id}
    ORDER BY dateTime DESC
    limit 4 ;`;

  const followingTweets = await db.all(followingTweetsQuery);
  response.send(followingTweets);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const requestUsername = request.body["username"];
  const getUserID = `
  SELECT user_id
  FROM user
  WHERE username='${requestUsername}';`;
  const userIdResult = await db.get(getUserID);

  const followingTweetsQuery = `
    SELECT user.username as name
    FROM follower
    INNER JOIN user ON follower.following_user_id=user.user_id
    WHERE follower.follower_user_id=${userIdResult.user_id} ;`;

  const followingTweets = await db.all(followingTweetsQuery);
  response.send(followingTweets);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const requestUsername = request.body["username"];
  const getUserID = `
  SELECT user_id
  FROM user
  WHERE username='${requestUsername}';`;
  const userIdResult = await db.get(getUserID);

  const followingTweetsQuery = `
    SELECT user.username as name
    FROM follower
    INNER JOIN user ON follower.follower_user_id=user.user_id
    WHERE follower.following_user_id=${userIdResult.user_id} ;`;

  const followingTweets = await db.all(followingTweetsQuery);
  response.send(followingTweets);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const requestUsername = request.body["username"];
  const getUserID = `
  SELECT user_id
  FROM user
  WHERE username='${requestUsername}';`;
  const userIdResult = await db.get(getUserID);
  const getFollowingUserIds = `
        SELECT tweet.tweet as tweet,
                
                count(like.like_id) as likes,
                count(reply.reply_id) as replies,
                tweet.date_time as dateTime
        FROM (tweet
        INNER JOIN like ON tweet.tweet_id=like.tweet_id) as T
        INNER JOIN reply ON T.tweet_id=reply.tweet_id
        WHERE tweet.tweet_id=${tweetId}
        AND tweet.user_id IN
        (SELECT DISTINCT user_id as user_id
    FROM follower
    INNER JOIN user
    ON follower.following_user_id=user.user_id);`;

  const result = await db.get(getFollowingUserIds);
  if (result !== undefined) {
    response.send(result);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});
let userList = [];
const convertToList = (dbObject) => {
  userList.push(dbObject["username"]);
};

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    getQueryUser = `
    SELECT user_id 
    FROM tweet 
    WHERE tweet_id=${tweetId}
    AND user_id IN
    ( SELECT follower.following_user_id as user_id
    FROM follower
    INNER JOIN user
    ON follower.following_user_id=user.user_id);`;
    const userQuery = await db.get(getQueryUser);
    if (userQuery === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikedUserQuery = `
        SELECT user.username as username
        FROM like
        INNER JOIN user ON user.user_id=like.user_id
        WHERE like.tweet_id=${tweetId};`;
      const likedUsers = await db.all(getLikedUserQuery);
      const mapList = likedUsers.map((each) => convertToList(each));
      response.send({ likes: userList });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;

    getQueryUser = `
    SELECT user_id 
    FROM tweet 
    WHERE tweet_id=${tweetId}
    AND user_id IN
    ( SELECT follower.following_user_id as user_id
    FROM follower
    INNER JOIN user
    ON follower.following_user_id=user.user_id);`;
    const userQuery = await db.get(getQueryUser);
    if (userQuery === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikedUserQuery = `
      SELECT user.username as name,
              reply.reply as reply
      FROM user
      INNER JOIN reply ON user.user_id=reply.user_id
      WHERE reply.tweet_id=${tweetId};`;
      const repliesQueryResult = await db.all(getLikedUserQuery);
      response.send({ replies: repliesQueryResult });
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const requestUsername = request.body["username"];
  const getUserID = `
  SELECT user_id
  FROM user
  WHERE username='${requestUsername}';`;
  const userIdResult = await db.get(getUserID);

  const getTweetQuey = `
  SELECT tweet.tweet as tweet,
  count(like.like_id) as likes,
  count(reply.reply_id)as replies,
  tweet.date_time as dateTime
  FROM (tweet
        INNER JOIN like ON tweet.tweet_id=like.tweet_id) as T
        INNER JOIN reply ON T.tweet_id=reply.tweet_id
  WHERE tweet.user_id=${userIdResult.user_id}
  GROUP BY tweet.tweet_id;`;
  const tweetResult = await db.all(getTweetQuey);
  response.send(tweetResult);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;

  const postTweetQuery = `
  INSERT INTO 
  tweet (tweet)
  VALUES ('${tweet}');`;

  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const requestUsername = request.body["username"];
    const { tweetId } = request.params;
    const verifyUserQuery = `
    SELECT user_id
    FROM user 
    WHERE username='${requestUsername}';`;
    const userQuery = await db.get(verifyUserQuery);
    const getTweetUserId = `
    SELECT user_id
    FROM tweet
    WHERE tweet_id=${tweetId};`;
    const tweetQuery = await db.get(getTweetUserId);
    if (tweetQuery !== undefined && userQuery !== undefined) {
      if (userQuery.user_id === tweetQuery.user_id) {
        const deleteQuery = `
           DELETE FROM tweet
           WHERE twee_id=${tweetId};`;
        await db.run(deleteQuery);
        response.send("Tweet Removed");
      } else {
        response.status(401);
        response.send("Invalid Request");
      }
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
