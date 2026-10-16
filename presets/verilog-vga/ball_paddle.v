
`include "hvsync_generator.v"
`include "digits10.v"
`include "scoreboard.v"

/*
A brick-smashing ball-and-paddle game.
*/

module ball_paddle_top(clk, reset, hpaddle, switches_p1, hsync, vsync, rgb);

  input clk;
  input reset;
  input hpaddle;
  input [7:0] switches_p1;	// player 1 keys (bit 0=left, 1=right)
  output hsync, vsync;
  output [2:0] rgb;
  wire display_on;
  wire [8:0] hpos;
  wire [8:0] vpos;
  
  reg [8:0] paddle_pos = PADDLE_MIN;	// paddle X position (moves once per frame)
  reg [8:0] hpaddle_pos = PADDLE_MIN;	// paddle X read from the paddle controller
  reg [8:0] hpaddle_last = 0;	// hpaddle_pos at the previous vsync
  
  reg [8:0] ball_x;	// ball X position
  reg [8:0] ball_y;	// ball Y position
  reg ball_dir_x;	// ball X direction (0=left, 1=right)
  reg ball_speed_x;	// ball speed (0=1 pixel/frame, 1=2 pixels/frame)
  reg ball_dir_y;	// ball Y direction (0=up, 1=down)
  
  reg brick_array [0:BRICKS_H*BRICKS_V-1]; // 16*8 = 128 bits

  wire [3:0] score0;	// score right digit
  wire [3:0] score1;	// score left digit
  wire [3:0] lives;	// # lives remaining
  reg incscore;		// incscore signal 
  reg declives = 0; // TODO
  
  localparam BRICKS_H = 16;	// # of bricks across
  localparam BRICKS_V = 8;	// # of bricks down

  localparam BALL_DIR_LEFT = 0;
  localparam BALL_DIR_RIGHT = 1;
  localparam BALL_DIR_DOWN = 1;
  localparam BALL_DIR_UP = 0;
  
  localparam PADDLE_WIDTH = 31;	// horizontal paddle size
  localparam PADDLE_MIN = 8;	// leftmost paddle X (right of left border)
  localparam PADDLE_MAX = 248 - PADDLE_WIDTH;	// rightmost paddle X (left of right border)
  localparam PADDLE_SPEED = 3;	// arrow key speed (pixels/frame)
  localparam BALL_SIZE = 6;	// square ball size

  // video sync generator  
  hvsync_generator hvsync_gen(
    .clk(clk),
    .reset(reset),
    .hsync(hsync),
    .vsync(vsync),
    .display_on(display_on),
    .hpos(hpos),
    .vpos(vpos)
  );
  
  // scoreboard
  wire score_gfx; // output from score generator
  player_stats stats(
    .reset(reset),
    .score0(score0),
    .score1(score1),
    .incscore(incscore),
    .lives(lives),
    .declives(declives)
  );

  scoreboard_generator score_gen(
    .score0(score0),
    .score1(score1),
    .lives(lives),
    .vpos(vpos),
    .hpos(hpos), 
    .board_gfx(score_gfx)
  );

  wire [5:0] hcell = hpos[8:3];		// horizontal brick index
  wire [5:0] vcell = vpos[8:3];		// vertical brick index
  wire lr_border = hcell==0 || hcell==31; // along horizontal border?

  // TODO: unsigned compare doesn't work in JS
  wire [8:0] paddle_rel_x = ((hpos-paddle_pos) & 9'h1ff);

  // player paddle graphics signal
  wire paddle_gfx = (vcell == 28) && (paddle_rel_x < PADDLE_WIDTH);

  // difference between ball position and video beam
  wire [8:0] ball_rel_x = (hpos - ball_x);
  wire [8:0] ball_rel_y = (vpos - ball_y);

  // ball graphics signal
  wire ball_gfx = ball_rel_x < BALL_SIZE
  	       && ball_rel_y < BALL_SIZE;

  reg main_gfx;		// main graphics signal (bricks and borders)
  reg brick_present;	// 1 when we are drawing a brick
  reg [6:0] brick_index;// index into array of current brick
  // brick graphics signal
  wire brick_gfx = lr_border || (brick_present && vpos[2:0] != 0 && hpos[3:1] != 4);
  
  // scan bricks: compute brick_index and brick_present flag
  always @(posedge clk)
    // see if we are scanning brick area
    if (vpos[8:6] == 1 && !lr_border)
    begin
      // every 16th pixel, starting at 8
      if (hpos[3:0] == 8) begin
        // compute brick index
        brick_index <= {vpos[5:3], hpos[7:4]};
      end
      // every 17th pixel
      else if (hpos[3:0] == 9) begin
        // load brick bit from array
        brick_present <= !brick_array[brick_index];
      end
    end else begin
      brick_present <= 0;
    end
  
  // read paddle controller (mouse): hpaddle goes high once the beam
  // passes its setting; clamp the reading between the side borders
  always @(posedge hsync)
    if (!hpaddle) begin
      if (vpos[8] || vpos < PADDLE_MIN)	// lines 256-261 come before line 0 (paddle far left)
        hpaddle_pos <= PADDLE_MIN;
      else if (vpos > PADDLE_MAX)	// right of border
        hpaddle_pos <= PADDLE_MAX;
      else
        hpaddle_pos <= vpos;
    end

  wire key_left = switches_p1[0];	// left arrow
  wire key_right = switches_p1[1];	// right arrow

  // move paddle once per frame: jump to the controller reading when it
  // changes (mouse moved), otherwise step with the arrow keys
  always @(posedge vsync)
    begin
      hpaddle_last <= hpaddle_pos;
      if (hpaddle_pos != hpaddle_last)
        paddle_pos <= hpaddle_pos;
      else if (key_left && !key_right)
        paddle_pos <= (paddle_pos < PADDLE_MIN + PADDLE_SPEED) ? PADDLE_MIN : paddle_pos - PADDLE_SPEED;
      else if (key_right && !key_left)
        paddle_pos <= (paddle_pos > PADDLE_MAX - PADDLE_SPEED) ? PADDLE_MAX : paddle_pos + PADDLE_SPEED;
    end

  // 1 when ball signal intersects main (brick + border) signal
  wire ball_pixel_collide = main_gfx & ball_gfx;
  
  reg ball_collide_paddle = 0;
  reg [3:0] ball_collide_bits = 0;

  // compute ball collisions with paddle and playfield
  always @(posedge clk)
    // clear all collide bits for frame
    if (vsync) begin
      ball_collide_bits <= 0; 
      ball_collide_paddle <= 0;
    end else begin
      if (ball_pixel_collide) begin
        // did we collide w/ paddle?
        if (paddle_gfx) begin
          ball_collide_paddle <= 1;
        end
        // ball has 4 collision quadrants
        if (!ball_rel_x[2] & !ball_rel_y[2]) ball_collide_bits[0] <= 1;
        if (ball_rel_x[2] & !ball_rel_y[2]) ball_collide_bits[1] <= 1;
        if (!ball_rel_x[2] & ball_rel_y[2]) ball_collide_bits[2] <= 1;
        if (ball_rel_x[2] & ball_rel_y[2]) ball_collide_bits[3] <= 1;
      end
    end

  // compute ball collisions with brick and increment score
  always @(posedge clk)
    if (ball_pixel_collide && brick_present) begin
      brick_array[brick_index] <= 1;
      incscore <= 1; // increment score
    end else begin
      incscore <= 0; // reset incscore
    end

  // computes position of ball in relation to center of paddle
  wire signed [8:0] ball_paddle_dx = ball_x - paddle_pos + 8;

  // ball bounce: determine new velocity/direction
  always @(posedge vsync or posedge reset)
    begin
      if (reset) begin
        ball_dir_y <= BALL_DIR_DOWN;
      end else
      // ball collided with paddle?
      if (ball_collide_paddle) begin 
        // bounces upward off of paddle
        ball_dir_y <= BALL_DIR_UP;
        // which side of paddle, left/right?
        ball_dir_x <= (ball_paddle_dx < 20) ? BALL_DIR_LEFT : BALL_DIR_RIGHT;
        // hitting with edge of paddle makes it fast
        ball_speed_x <= ball_collide_bits[3:0] != 4'b1100;
      end else begin
        // collided with playfield
        // TODO: can still slip through corners
        // compute left/right bounce
        casez (ball_collide_bits[3:0])
          4'b01?1: ball_dir_x <= BALL_DIR_RIGHT; // left edge/corner
          4'b1101: ball_dir_x <= BALL_DIR_RIGHT; // left corner
          4'b101?: ball_dir_x <= BALL_DIR_LEFT; // right edge/corner
          4'b1110: ball_dir_x <= BALL_DIR_LEFT; // right corner
          default: ;
        endcase
        // compute top/bottom bounce
        casez (ball_collide_bits[3:0])
          4'b1011: ball_dir_y <= BALL_DIR_DOWN;
          4'b0111: ball_dir_y <= BALL_DIR_DOWN;
          4'b001?: ball_dir_y <= BALL_DIR_DOWN;
          4'b0001: ball_dir_y <= BALL_DIR_DOWN;
          4'b0100: ball_dir_y <= BALL_DIR_UP;
          4'b1?00: ball_dir_y <= BALL_DIR_UP;
          4'b1101: ball_dir_y <= BALL_DIR_UP;
          4'b1110: ball_dir_y <= BALL_DIR_UP;
          default: ;
        endcase
      end
    end
  
  // ball motion: update ball position
  always @(negedge vsync or posedge reset)
    begin
      if (reset) begin
        // reset ball position to top center
        ball_x <= 128;
        ball_y <= 180;
      end else begin
        // move ball horizontal and vertical position
        if (ball_dir_x == BALL_DIR_RIGHT)
          ball_x <= ball_x + (ball_speed_x?1:0) + 1;
        else
          ball_x <= ball_x - (ball_speed_x?1:0) - 1;
        ball_y <= ball_y + (ball_dir_y==BALL_DIR_DOWN?1:-1);
      end
    end
  
  // compute main_gfx
  always @(*)
    begin
      case (vpos[8:3])
        0,1,2: main_gfx = score_gfx; // scoreboard
        3: main_gfx = 0;
        4: main_gfx = 1; // top border
        8,9,10,11,12,13,14,15: main_gfx = brick_gfx; // brick rows 1-8
        28: main_gfx = paddle_gfx | lr_border; // paddle
        29: main_gfx = hpos[0] ^ vpos[0]; // bottom border
        default: main_gfx = lr_border; // left/right borders
      endcase
    end

  // combine signals to RGB output
  wire grid_gfx = (((hpos&7)==0) || ((vpos&7)==0));
  wire r = display_on && (ball_gfx | paddle_gfx);
  wire g = display_on && (main_gfx | ball_gfx);
  wire b = display_on && (grid_gfx | ball_gfx | brick_present);
  assign rgb = {b,g,r};

endmodule
