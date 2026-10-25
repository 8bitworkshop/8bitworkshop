	'
	' Bouncing happy face (demo for CVBasic)
	'
	' by Oscar Toledo G.
	' https://nanochess.org/
	'
	' Creation date: Feb/28/2024.
	'

	DEFINE SPRITE 0,1,happy_face

	PRINT AT 36,"Happy face!"

	x = 50
	y = 100
	dx = 1
	dy = 1

game_loop:
	WAIT
	WAIT
	SPRITE 0,y-1,x,0,10

	x = x + dx
	IF x = 0 THEN dx = -dx
	IF x = 240 THEN dx = -dx
	y = y + dy
	IF y = 0 THEN dy = -dy
	IF y = 176 THEN dy = -dy
	GOTO game_loop

happy_face:
	BITMAP "......XXXX......"
	BITMAP "....XXXXXXXX...."
	BITMAP "...XXXXXXXXXX..."
	BITMAP "..XXXXXXXXXXXX.."
	BITMAP ".XXXXXXXXXXXXXX."
	BITMAP ".XXXXXXXXXXXXXX."
	BITMAP "XXXX..XXXX..XXXX"
	BITMAP "XXXX..XXXX..XXXX"
	BITMAP "XXXXXXXXXXXXXXXX"
	BITMAP "XXXXXXXXXXXXXXXX"
	BITMAP ".XXXXXXXXXXXXXX."
	BITMAP ".XXX..XXXX..XXX."
	BITMAP "..XXX......XXX.."
	BITMAP "...XXX....XXX..."
	BITMAP "....XXXXXXXX...."
	BITMAP "......XXXX......"
