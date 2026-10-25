	'
	' CVBasic hello world.
	'
	' CVBasic is a BASIC compiler that targets many retro consoles;
	' this same program also builds for MSX and SG-1000 (see their
	' presets). The toolchain is CVBasic + gasm80, both from
	' https://github.com/nanochess
	'
	' The screen starts in text mode, so we just PRINT and move a sprite.
	'

	PRINT AT 0,"HELLO FROM CVBASIC!"
	PRINT AT 32,"ARROWS MOVE THE FACE"

	DEFINE SPRITE 0,1,face

	x = 120
	y = 96
loop:
	WAIT					' wait for the video interrupt
	IF CONT1.UP THEN y = y - 2
	IF CONT1.DOWN THEN y = y + 2
	IF CONT1.LEFT THEN x = x - 2
	IF CONT1.RIGHT THEN x = x + 2
	SPRITE 0,y-1,x,0,10			' show sprite 0 (16x16) in yellow
	GOTO loop

	' A 16x16 sprite: "X" is the foreground color, "." is transparent.
face:
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
