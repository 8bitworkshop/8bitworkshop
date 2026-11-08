/*  assert.h - Assert macro for CMOC

    By Pierre Sarrazin <http://sarrazip.com/>.
    This file is in the public domain.
*/

#ifndef _ASSERT_H
#define _ASSERT_H

#include <cmoc.h>

#ifdef NDEBUG
#define assert(cond)
#else
#define assert(cond) do { if (!(cond)) { \
                        printf("***ASSERT FAILED: %s:%u: %s\n", __FILE__, __LINE__, #cond); \
                        for (;;); } } while (0)
#endif

#endif  /* _ASSERT_H */
